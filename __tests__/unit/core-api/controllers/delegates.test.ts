import "jest-extended";

import Hapi from "@hapi/hapi";
import { DelegatesController } from "@packages/core-api/src/controllers/delegates";
import { CryptoSuite } from "@packages/core-crypto";
import { Block } from "@packages/core-database/src/models";
import { Application, Contracts } from "@packages/core-kernel";
import { Identifiers } from "@packages/core-kernel/src/ioc";
import { Transactions as MagistrateTransactions } from "@packages/core-magistrate-crypto";
import { Wallets } from "@packages/core-state";
import passphrases from "@packages/core-test-framework/src/internal/passphrases.json";
import { TransactionHandlerRegistry } from "@packages/core-transactions/src/handlers/handler-registry";

import { buildSenderWallet, initApp, ItemResponse, PaginatedResponse } from "../__support__";

const crypto = new CryptoSuite.CryptoSuite(CryptoSuite.CryptoManager.findNetworkByName("devnet"));

let app: Application;
let controller: DelegatesController;
let walletRepository: Wallets.WalletRepository;

const blockHistoryService = {
    listByCriteria: jest.fn(),
};

beforeEach(() => {
    app = initApp(crypto);

    // Triggers registration of indexes
    app.get<TransactionHandlerRegistry>(Identifiers.TransactionHandlerRegistry);
    app.bind(Identifiers.BlockHistoryService).toConstantValue(blockHistoryService);

    controller = app.resolve<DelegatesController>(DelegatesController);
    walletRepository = app.get<Wallets.WalletRepository>(Identifiers.WalletRepository);
    blockHistoryService.listByCriteria.mockReset();
});

afterEach(() => {
    try {
        crypto.TransactionManager.TransactionTools.TransactionRegistry.deregisterTransactionType(
            MagistrateTransactions.BusinessRegistrationTransaction,
        );
        crypto.TransactionManager.TransactionTools.TransactionRegistry.deregisterTransactionType(
            MagistrateTransactions.BridgechainRegistrationTransaction,
        );
    } catch {}
});

describe("DelegatesController", () => {
    let delegateWallet: Contracts.State.Wallet;
    let delegateAttributes: any;

    beforeEach(() => {
        delegateWallet = buildSenderWallet(app, crypto);

        delegateAttributes = {
            username: "delegate",
            voteBalance: crypto.CryptoManager.LibraryManager.Libraries.BigNumber.make("200"),
            rank: 1,
            resigned: false,
            producedBlocks: 0,
            forgedFees: crypto.CryptoManager.LibraryManager.Libraries.BigNumber.make("2"),
            forgedRewards: crypto.CryptoManager.LibraryManager.Libraries.BigNumber.make("200"),
            lastBlock: {
                id: "123",
                height: 2,
                timestamp: 2,
            },
        };

        delegateWallet.setAttribute("delegate", delegateAttributes);

        walletRepository.index(delegateWallet);
    });

    describe("index", () => {
        it("should return list of delegates", async () => {
            const request: Hapi.Request = {
                query: {
                    page: 1,
                    limit: 100,
                    transform: false,
                },
            };

            const response = (await controller.index(request, undefined)) as PaginatedResponse;

            expect(response.totalCount).toBeDefined();
            expect(response.meta).toBeDefined();
            expect(response.results).toBeDefined();
            expect(response.results[0]).toEqual(
                expect.objectContaining({
                    username: delegateAttributes.username,
                }),
            );
        });
    });

    describe("show", () => {
        it("should return delegate", async () => {
            const request: Hapi.Request = {
                params: {
                    id: delegateWallet.publicKey,
                },
            };

            const response = (await controller.show(request, undefined)) as ItemResponse;

            expect(response.data).toEqual(
                expect.objectContaining({
                    username: delegateAttributes.username,
                }),
            );
        });

        it("should return error if delegate does not exist", async () => {
            const request: Hapi.Request = {
                params: {
                    id: crypto.CryptoManager.Identities.PublicKey.fromPassphrase(passphrases[1]),
                },
            };

            await expect(controller.show(request, undefined)).resolves.toThrowError("Delegate not found");
        });

        it("should return error if delegate does not have username", async () => {
            const request: Hapi.Request = {
                params: {
                    id: delegateWallet.publicKey,
                },
            };

            delegateWallet.forgetAttribute("delegate.username");

            await expect(controller.show(request, undefined)).resolves.toThrowError("Delegate not found");
        });
    });

    describe("search", () => {
        it("should return list of delegates", async () => {
            const request: Hapi.Request = {
                params: {
                    id: delegateWallet.publicKey,
                },
                query: {
                    page: 1,
                    limit: 100,
                    transform: false,
                },
            };

            const response = (await controller.search(request, undefined)) as PaginatedResponse;

            expect(response.totalCount).toBeDefined();
            expect(response.meta).toBeDefined();
            expect(response.results).toBeDefined();
            expect(response.results[0]).toEqual(
                expect.objectContaining({
                    username: delegateAttributes.username,
                }),
            );
        });
    });

    describe("blocks", () => {
        it("should return list of blocks", async () => {
            const mockBlock: Partial<Block> = {
                id: "17184958558311101492",
                reward: crypto.CryptoManager.LibraryManager.Libraries.BigNumber.make("100"),
                totalFee: crypto.CryptoManager.LibraryManager.Libraries.BigNumber.make("200"),
                totalAmount: crypto.CryptoManager.LibraryManager.Libraries.BigNumber.make("300"),
            };

            blockHistoryService.listByCriteria.mockResolvedValue({
                rows: [mockBlock],
                count: 1,
                countIsEstimate: false,
            });

            const request: Hapi.Request = {
                params: {
                    id: delegateWallet.publicKey,
                },
                query: {
                    page: 1,
                    limit: 100,
                    transform: false,
                },
            };

            const response = (await controller.blocks(request, undefined)) as PaginatedResponse;

            expect(response.totalCount).toBeDefined();
            expect(response.meta).toBeDefined();
            expect(response.results).toBeDefined();
            expect(response.results[0]).toEqual(
                expect.objectContaining({
                    id: mockBlock.id,
                }),
            );
        });

        // TODO
        it("should return list of transformed blocks", async () => {
            const mockBlock: Partial<Block> = {
                id: "17184958558311101492",
                reward: crypto.CryptoManager.LibraryManager.Libraries.BigNumber.make("100"),
                totalFee: crypto.CryptoManager.LibraryManager.Libraries.BigNumber.make("200"),
                totalAmount: crypto.CryptoManager.LibraryManager.Libraries.BigNumber.make("300"),
                generatorPublicKey: crypto.CryptoManager.Identities.PublicKey.fromPassphrase(passphrases[0]),
                timestamp: 2,
            };

            blockHistoryService.listByCriteria.mockResolvedValue({
                rows: [mockBlock],
                count: 1,
                countIsEstimate: false,
            });

            const request: Hapi.Request = {
                params: {
                    id: delegateWallet.publicKey,
                },
                query: {
                    page: 1,
                    limit: 100,
                    transform: true,
                },
            };

            const response = (await controller.blocks(request, undefined)) as PaginatedResponse;

            expect(response.totalCount).toBeDefined();
            expect(response.meta).toBeDefined();
            expect(response.results).toBeDefined();
            expect(response.results[0]).toEqual(
                expect.objectContaining({
                    id: mockBlock.id,
                }),
            );
        });

        it("should return error if delegate does not exists", async () => {
            const request: Hapi.Request = {
                params: {
                    id: crypto.CryptoManager.Identities.PublicKey.fromPassphrase(passphrases[1]),
                },
                query: {
                    page: 1,
                    limit: 100,
                    transform: false,
                },
            };

            await expect(controller.blocks(request, undefined)).resolves.toThrowError("Delegate not found");
        });
    });

    describe("voters", () => {
        it("should return list of voting wallets", async () => {
            const voteWallet = buildSenderWallet(app, crypto, passphrases[1]);

            voteWallet.setAttribute("vote", delegateWallet.publicKey);

            walletRepository.index(voteWallet);

            const request: Hapi.Request = {
                params: {
                    id: delegateWallet.publicKey,
                },
                query: {
                    page: 1,
                    limit: 100,
                    transform: false,
                },
            };

            const response = (await controller.voters(request, undefined)) as PaginatedResponse;

            expect(response.totalCount).toBeDefined();
            expect(response.meta).toBeDefined();
            expect(response.results).toBeDefined();
            expect(response.results[0]).toEqual(
                expect.objectContaining({
                    address: voteWallet.address,
                    publicKey: voteWallet.publicKey,
                }),
            );
        });

        it("should return error if delegate does not exists", async () => {
            const request: Hapi.Request = {
                params: {
                    id: crypto.CryptoManager.Identities.PublicKey.fromPassphrase(passphrases[1]),
                },
                query: {
                    page: 1,
                    limit: 100,
                    transform: false,
                },
            };

            await expect(controller.voters(request, undefined)).resolves.toThrowError("Delegate not found");
        });
    });
});