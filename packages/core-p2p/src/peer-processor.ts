import { Container, Contracts, Enums, Providers, Utils as KernelUtils } from "@arkecosystem/core-kernel";
import { Utils } from "@arkecosystem/crypto";

import { PeerFactory } from "./contracts";
import { DisconnectInvalidPeers } from "./listeners";
import { getAllPeerPorts } from "./socket-server/utils/get-peer-port";

// todo: review the implementation
@Container.injectable()
export class PeerProcessor implements Contracts.P2P.PeerProcessor {
    @Container.inject(Container.Identifiers.Application)
    private readonly app!: Contracts.Kernel.Application;

    @Container.inject(Container.Identifiers.PluginConfiguration)
    @Container.tagged("plugin", "@arkecosystem/core-p2p")
    private readonly configuration!: Providers.PluginConfiguration;

    @Container.inject(Container.Identifiers.PeerCommunicator)
    private readonly communicator!: Contracts.P2P.PeerCommunicator;

    @Container.inject(Container.Identifiers.PeerConnector)
    private readonly connector!: Contracts.P2P.PeerConnector;

    @Container.inject(Container.Identifiers.PeerStorage)
    private readonly storage!: Contracts.P2P.PeerStorage;

    @Container.inject(Container.Identifiers.EventDispatcherService)
    private readonly events!: Contracts.Kernel.EventDispatcher;

    @Container.inject(Container.Identifiers.LogService)
    private readonly logger!: Contracts.Kernel.Logger;

    public server: any;
    public nextUpdateNetworkStatusScheduled: boolean = false;

    public initialize() {
        this.events.listen(Enums.CryptoEvent.MilestoneChanged, this.app.resolve(DisconnectInvalidPeers));
    }

    public isWhitelisted(peer: Contracts.P2P.Peer): boolean {
        return KernelUtils.isWhitelisted(this.configuration.getOptional<string[]>("remoteAccess", []), peer.ip);
    }

    public async validateAndAcceptPeer(
        peer: Contracts.P2P.Peer,
        options: Contracts.P2P.AcceptNewPeerOptions = {},
    ): Promise<void> {
        /* istanbul ignore else */
        if (this.validatePeerIp(peer, options)) {
            await this.acceptNewPeer(peer, options);
        }
    }

    public validatePeerIp(peer, options: Contracts.P2P.AcceptNewPeerOptions = {}): boolean {
        if (this.configuration.get("disableDiscovery")) {
            this.logger.warning(`Rejected ${peer.ip} because the relay is in non-discovery mode.`);
            return false;
        }

        if (!Utils.isValidPeer(peer) || this.storage.hasPendingPeer(peer.ip)) {
            return false;
        }

        // Is Whitelisted
        if (!KernelUtils.isWhitelisted(this.configuration.get("whitelist") || [], peer.ip)) {
            return false;
        }

        // Is Blacklisted
        if (KernelUtils.isBlacklisted(this.configuration.get("blacklist") || [], peer.ip)) {
            return false;
        }

        const maxSameSubnetPeers = this.configuration.getRequired<number>("maxSameSubnetPeers");

        if (this.storage.getSameSubnetPeers(peer.ip).length >= maxSameSubnetPeers && !options.seed) {
            /* istanbul ignore else */
            if (process.env.CORE_P2P_PEER_VERIFIER_DEBUG_EXTRA) {
                this.logger.warning(
                    `Rejected ${peer.ip} because we are already at the ${maxSameSubnetPeers} limit for peers sharing the same /24 subnet.`,
                );
            }

            return false;
        }

        return true;
    }

    private async acceptNewPeer(peer, options: Contracts.P2P.AcceptNewPeerOptions): Promise<void> {
        if (this.storage.hasPeer(peer.ip)) {
            return;
        }

        const newPeer: Contracts.P2P.Peer = this.app.get<PeerFactory>(Container.Identifiers.PeerFactory)(peer.ip);

        try {
            this.storage.setPendingPeer(peer);

            const verifyTimeout = this.configuration.getRequired<number>("verifyTimeout");

            await this.communicator.ping(newPeer, verifyTimeout);

            this.storage.setPeer(newPeer);

            /* istanbul ignore next */
            if (!options.lessVerbose || process.env.CORE_P2P_PEER_VERIFIER_DEBUG_EXTRA) {
                this.logger.debug(`Accepted new peer ${newPeer.ip}:${newPeer.port} (v${newPeer.version})`);
            }

            this.events.dispatch(Enums.PeerEvent.Added, newPeer);
        } catch (error) {
            for (const port of getAllPeerPorts(newPeer)) {
                this.connector.disconnect(newPeer, port);
            }
        } finally {
            this.storage.forgetPendingPeer(peer);
        }

        return;
    }
}
