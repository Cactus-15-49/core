import "jest-extended";

import { CryptoSuite, Interfaces as BlockInterfaces } from "@packages/core-crypto/src";
import { Application, Contracts } from "@packages/core-kernel";
import { Identifiers } from "@packages/core-kernel/src/ioc";
import { Wallets } from "@packages/core-state";
import { StateStore } from "@packages/core-state/src/stores/state";
import { Generators } from "@packages/core-test-framework/src";
import { Factories, FactoryBuilder } from "@packages/core-test-framework/src/factories";
import passphrases from "@packages/core-test-framework/src/internal/passphrases.json";
import {
    InsufficientBalanceError,
    InvalidMultiSignatureError,
    InvalidSecondSignatureError,
    LegacyMultiSignatureError,
    SenderWalletMismatchError,
    UnexpectedMultiSignatureError,
    UnexpectedNonceError,
    UnexpectedSecondSignatureError,
} from "@packages/core-transactions/src/errors";
import { TransactionHandler } from "@packages/core-transactions/src/handlers";
import { TransactionHandlerRegistry } from "@packages/core-transactions/src/handlers/handler-registry";
import { Enums, Interfaces, Transactions } from "@packages/crypto";
import { IMultiSignatureAsset } from "@packages/crypto/src/interfaces";

import {
    buildMultiSignatureWallet,
    buildRecipientWallet,
    buildSecondSignatureWallet,
    buildSenderWallet,
    initApp,
} from "../__support__/app";

let app: Application;
let senderWallet: Wallets.Wallet;
let secondSignatureWallet: Wallets.Wallet;
let multiSignatureWallet: Wallets.Wallet;
let recipientWallet: Wallets.Wallet;
let walletRepository: Contracts.State.WalletRepository;
let factoryBuilder: FactoryBuilder;

let mockLastBlockData: Partial<BlockInterfaces.IBlockData>;
const mockGetLastBlock = jest.fn();
StateStore.prototype.getLastBlock = mockGetLastBlock;
mockGetLastBlock.mockReturnValue({ data: mockLastBlockData });

let crypto: CryptoSuite.CryptoSuite;

beforeEach(() => {
    crypto = new CryptoSuite.CryptoSuite({
        ...Generators.generateCryptoConfigRaw(),
    });
    crypto.CryptoManager.HeightTracker.setHeight(2);

    app = initApp(crypto);

    walletRepository = app.get<Wallets.WalletRepository>(Identifiers.WalletRepository);

    mockLastBlockData = { timestamp: crypto.CryptoManager.LibraryManager.Crypto.Slots.getTime(), height: 4 };

    factoryBuilder = new FactoryBuilder();
    Factories.registerWalletFactory(factoryBuilder);
    Factories.registerTransactionFactory(factoryBuilder);

    senderWallet = buildSenderWallet(factoryBuilder, crypto.CryptoManager);
    secondSignatureWallet = buildSecondSignatureWallet(factoryBuilder, crypto.CryptoManager);
    multiSignatureWallet = buildMultiSignatureWallet(crypto.CryptoManager);
    recipientWallet = buildRecipientWallet(factoryBuilder);

    walletRepository.index(senderWallet);
    walletRepository.index(secondSignatureWallet);
    walletRepository.index(multiSignatureWallet);
    walletRepository.index(recipientWallet);
});

describe("General Tests", () => {
    let transferTransaction: Interfaces.ITransaction;
    let transactionWithSecondSignature: Interfaces.ITransaction;
    let multiSignatureTransferTransaction: Interfaces.ITransaction;
    let handler: TransactionHandler;

    beforeEach(async () => {
        const transactionHandlerRegistry: TransactionHandlerRegistry = app.get<TransactionHandlerRegistry>(
            Identifiers.TransactionHandlerRegistry,
        );
        handler = transactionHandlerRegistry.getRegisteredHandlerByType(
            Transactions.InternalTransactionType.from(Enums.TransactionType.Transfer, Enums.TransactionTypeGroup.Core),
            2,
        );

        transferTransaction = crypto.TransactionManager.BuilderFactory.transfer()
            .recipientId(recipientWallet.address)
            .amount("10000000")
            .nonce("1")
            .sign(passphrases[0])
            .build();

        transactionWithSecondSignature = crypto.TransactionManager.BuilderFactory.transfer()
            .recipientId(recipientWallet.address)
            .amount("10000000")
            .nonce("1")
            .sign(passphrases[0])
            .secondSign(passphrases[1])
            .build();

        multiSignatureTransferTransaction = crypto.TransactionManager.BuilderFactory.transfer()
            .senderPublicKey(multiSignatureWallet.publicKey!)
            .recipientId(recipientWallet.address)
            .amount("1")
            .nonce("1")
            .multiSign(passphrases[0], 0)
            .multiSign(passphrases[1], 1)
            .multiSign(passphrases[2], 2)
            .build();
    });

    describe("verify", () => {
        it("should be verified", async () => {
            await expect(handler.verify(transferTransaction, walletRepository)).resolves.toBeTrue();
        });

        it("should be verified with multi sign", async () => {
            await expect(handler.verify(multiSignatureTransferTransaction, walletRepository)).resolves.toBeTrue();
        });
    });

    describe("throwIfCannotBeApplied", () => {
        it("should not throw", async () => {
            await expect(
                handler.throwIfCannotBeApplied(transferTransaction, senderWallet, walletRepository),
            ).toResolve();
        });

        it("should throw if wallet publicKey does not match transaction senderPublicKey", async () => {
            transferTransaction.data.senderPublicKey = "a".repeat(66);
            await expect(
                handler.throwIfCannotBeApplied(transferTransaction, senderWallet, walletRepository),
            ).rejects.toThrowError(SenderWalletMismatchError);
        });

        it("should throw if the transaction has a second signature but wallet does not", async () => {
            await expect(
                handler.throwIfCannotBeApplied(transactionWithSecondSignature, senderWallet, walletRepository),
            ).rejects.toThrowError(UnexpectedSecondSignatureError);
        });

        it("should throw if the sender has a second signature, but stored walled has not", async () => {
            const secondSigWallet = buildSenderWallet(factoryBuilder, crypto.CryptoManager);
            secondSigWallet.setAttribute(
                "secondPublicKey",
                "038082dad560a22ea003022015e3136b21ef1ffd9f2fd50049026cbe8e2258ca17",
            );
            await expect(
                handler.throwIfCannotBeApplied(transferTransaction, secondSigWallet, walletRepository),
            ).rejects.toThrowError(UnexpectedSecondSignatureError);
        });

        it("should throw if nonce is invalid", async () => {
            senderWallet.nonce = crypto.CryptoManager.LibraryManager.Libraries.BigNumber.make(1);
            await expect(
                handler.throwIfCannotBeApplied(transferTransaction, senderWallet, walletRepository),
            ).rejects.toThrowError(UnexpectedNonceError);
        });

        it("should throw if sender has legacy multi signature", async () => {
            const multiSignatureAsset: IMultiSignatureAsset = {
                publicKeys: [
                    crypto.CryptoManager.Identities.PublicKey.fromPassphrase(passphrases[0]),
                    crypto.CryptoManager.Identities.PublicKey.fromPassphrase(passphrases[1]),
                    crypto.CryptoManager.Identities.PublicKey.fromPassphrase(passphrases[2]),
                ],
                min: 2,
                // @ts-ignore
                legacy: true,
            };

            senderWallet.setAttribute("multiSignature", multiSignatureAsset);
            await expect(
                handler.throwIfCannotBeApplied(transferTransaction, senderWallet, walletRepository),
            ).rejects.toThrowError(LegacyMultiSignatureError);
        });

        it("should throw if sender has multi signature, but indexed wallet has not", async () => {
            const multiSignatureAsset: IMultiSignatureAsset = {
                publicKeys: [
                    crypto.CryptoManager.Identities.PublicKey.fromPassphrase(passphrases[0]),
                    crypto.CryptoManager.Identities.PublicKey.fromPassphrase(passphrases[1]),
                    crypto.CryptoManager.Identities.PublicKey.fromPassphrase(passphrases[2]),
                ],
                min: 2,
            };

            const multiSigWallet = buildSenderWallet(factoryBuilder, crypto.CryptoManager);
            multiSigWallet.setAttribute("multiSignature", multiSignatureAsset);
            await expect(
                handler.throwIfCannotBeApplied(transferTransaction, multiSigWallet, walletRepository),
            ).rejects.toThrowError(UnexpectedMultiSignatureError);
        });

        it("should throw if sender and transaction multi signatures does not match", async () => {
            const multiSignatureAsset: IMultiSignatureAsset = {
                publicKeys: [
                    crypto.CryptoManager.Identities.PublicKey.fromPassphrase(passphrases[1]),
                    crypto.CryptoManager.Identities.PublicKey.fromPassphrase(passphrases[0]),
                    crypto.CryptoManager.Identities.PublicKey.fromPassphrase(passphrases[2]),
                ],
                min: 2,
            };

            multiSignatureWallet.setAttribute("multiSignature", multiSignatureAsset);
            await expect(
                handler.throwIfCannotBeApplied(
                    multiSignatureTransferTransaction,
                    multiSignatureWallet,
                    walletRepository,
                ),
            ).rejects.toThrowError(InvalidMultiSignatureError);
        });

        it("should throw if transaction has signatures and it is not multi signature registration", async () => {
            transferTransaction.data.signatures = [
                "009fe6ca3b83a9a5e693fecb2b184900c5135a8c07e704c473b2f19117630f840428416f583f1a24ff371ba7e6fbca9a7fb796226ef9ef6542f44ed911951ac88d",
                "0116779a98b2009b35d4003dda7628e46365f1a52068489bfbd80594770967a3949f76bc09e204eddd7d460e1e519b826c53dc6e2c9573096326dbc495050cf292",
                "02687bd0f4a91be39daf648a5b1e1af5ffa4a3d4319b2e38b1fc2dc206db03f542f3b26c4803e0b4c8a53ddfb6cf4533b512d71ae869d4e4ccba989c4a4222396b",
            ];
            await expect(
                handler.throwIfCannotBeApplied(transferTransaction, senderWallet, walletRepository),
            ).rejects.toThrowError(UnexpectedMultiSignatureError);
        });

        it("should throw if wallet and transaction second signatures does not match", async () => {
            senderWallet.setAttribute("secondPublicKey", "invalid-public-key");
            await expect(
                handler.throwIfCannotBeApplied(transactionWithSecondSignature, senderWallet, walletRepository),
            ).rejects.toThrow(InvalidSecondSignatureError);
        });

        it("should throw if wallet has not enough balance", async () => {
            // 1 arktoshi short
            senderWallet.balance = transferTransaction.data.amount.plus(transferTransaction.data.fee).minus(1);
            await expect(
                handler.throwIfCannotBeApplied(transferTransaction, senderWallet, walletRepository),
            ).rejects.toThrow(InsufficientBalanceError);
        });

        it("should be true even with publicKey case mismatch", async () => {
            transferTransaction.data.senderPublicKey = transferTransaction.data.senderPublicKey!.toUpperCase();
            senderWallet.publicKey = senderWallet.publicKey!.toLowerCase();

            const instance: Interfaces.ITransaction = crypto.TransactionManager.TransactionFactory.fromData(
                transferTransaction.data,
            );
            await expect(handler.throwIfCannotBeApplied(instance, senderWallet, walletRepository)).toResolve();
        });
    });

    describe("dynamicFees", () => {
        beforeEach(async () => {
            const transactionHandlerRegistry: TransactionHandlerRegistry = app.get<TransactionHandlerRegistry>(
                Identifiers.TransactionHandlerRegistry,
            );
            handler = transactionHandlerRegistry.getRegisteredHandlerByType(
                Transactions.InternalTransactionType.from(
                    Enums.TransactionType.Transfer,
                    Enums.TransactionTypeGroup.Core,
                ),
                2,
            );

            transferTransaction = crypto.TransactionManager.BuilderFactory.transfer()
                .amount("10000000")
                .recipientId(recipientWallet.address)
                .sign("secret")
                .nonce("0")
                .build();

            crypto.CryptoManager.MilestoneManager.getMilestone().aip11 = true;
        });

        it("should correctly calculate the transaction fee based on transaction size and addonBytes", async () => {
            const addonBytes = 137;

            expect(
                handler.dynamicFee({ transaction: transferTransaction, addonBytes, satoshiPerByte: 3, height: 1 }),
            ).toEqual(
                crypto.CryptoManager.LibraryManager.Libraries.BigNumber.make(
                    137 + transferTransaction.serialized.length / 2,
                ).times(3),
            );

            expect(
                handler.dynamicFee({ transaction: transferTransaction, addonBytes, satoshiPerByte: 6, height: 1 }),
            ).toEqual(
                crypto.CryptoManager.LibraryManager.Libraries.BigNumber.make(
                    137 + transferTransaction.serialized.length / 2,
                ).times(6),
            );

            expect(
                handler.dynamicFee({ transaction: transferTransaction, addonBytes: 0, satoshiPerByte: 9, height: 1 }),
            ).toEqual(
                crypto.CryptoManager.LibraryManager.Libraries.BigNumber.make(
                    transferTransaction.serialized.length / 2,
                ).times(9),
            );
        });

        it("should default satoshiPerByte to 1 if value provided is <= 0", async () => {
            expect(
                handler.dynamicFee({ transaction: transferTransaction, addonBytes: 0, satoshiPerByte: -50, height: 1 }),
            ).toEqual(
                handler.dynamicFee({ transaction: transferTransaction, addonBytes: 0, satoshiPerByte: 1, height: 1 }),
            );
            expect(
                handler.dynamicFee({ transaction: transferTransaction, addonBytes: 0, satoshiPerByte: 0, height: 1 }),
            ).toEqual(
                handler.dynamicFee({ transaction: transferTransaction, addonBytes: 0, satoshiPerByte: 1, height: 1 }),
            );
        });
    });

    describe("apply", () => {
        afterEach(() => {
            process.env.CORE_ENV === "test";
        });

        it("should resolve", async () => {
            await expect(handler.apply(transferTransaction, walletRepository)).toResolve();
        });

        it("should not fail due to case mismatch", async () => {
            const transactionData: Interfaces.ITransactionData = transferTransaction.data;
            transactionData.senderPublicKey = transactionData.senderPublicKey?.toUpperCase();
            const instance = crypto.TransactionManager.TransactionFactory.fromData(transactionData);

            const senderBalance = senderWallet.balance;
            const recipientBalance = recipientWallet.balance;

            await handler.apply(instance, walletRepository);

            expect(senderWallet.balance).toEqual(
                crypto.CryptoManager.LibraryManager.Libraries.BigNumber.make(senderBalance)
                    .minus(instance.data.amount)
                    .minus(instance.data.fee),
            );

            expect(recipientWallet.balance).toEqual(
                crypto.CryptoManager.LibraryManager.Libraries.BigNumber.make(recipientBalance).plus(
                    instance.data.amount,
                ),
            );
        });

        it("should resolve defined as exception", async () => {
            crypto.CryptoManager.NetworkConfigManager.set("exceptions.transactions", [transferTransaction.id]);
            crypto.CryptoManager.NetworkConfigManager.set("network.pubKeyHash", 99);
            await expect(handler.apply(transferTransaction, walletRepository)).toResolve();
        });

        it("should resolve with V1", async () => {
            crypto.CryptoManager.MilestoneManager.getMilestone().aip11 = false;

            transferTransaction = crypto.TransactionManager.BuilderFactory.transfer()
                .recipientId(recipientWallet.address)
                .amount("10000000")
                .nonce("1")
                .sign(passphrases[0])
                .build();

            await expect(handler.apply(transferTransaction, walletRepository)).toResolve();
        });

        it("should throw with negative balance", async () => {
            senderWallet.balance = crypto.CryptoManager.LibraryManager.Libraries.BigNumber.ZERO;
            await expect(handler.apply(transferTransaction, walletRepository)).rejects.toThrow(
                InsufficientBalanceError,
            );
        });

        it("should throw with negative balance if environment is not test", async () => {
            process.env.CORE_ENV === "unitest";
            senderWallet.balance = crypto.CryptoManager.LibraryManager.Libraries.BigNumber.ZERO;
            await expect(handler.apply(transferTransaction, walletRepository)).rejects.toThrow(
                InsufficientBalanceError,
            );
        });
    });

    describe("revert", () => {
        it("should resolve", async () => {
            await expect(handler.apply(transferTransaction, walletRepository)).toResolve();
            await expect(handler.revert(transferTransaction, walletRepository)).toResolve();
        });

        it("should throw if nonce is invalid", async () => {
            await expect(handler.apply(transferTransaction, walletRepository)).toResolve();
            senderWallet.nonce = crypto.CryptoManager.LibraryManager.Libraries.BigNumber.make(100);
            await expect(handler.revert(transferTransaction, walletRepository)).rejects.toThrow(UnexpectedNonceError);
        });

        it("should not fail due to case mismatch", async () => {
            senderWallet.nonce = crypto.CryptoManager.LibraryManager.Libraries.BigNumber.make(1);

            const transactionData: Interfaces.ITransactionData = transferTransaction.data;
            transactionData.senderPublicKey = transactionData.senderPublicKey?.toUpperCase();
            const instance = crypto.TransactionManager.TransactionFactory.fromData(transactionData);

            const senderBalance = senderWallet.balance;
            const recipientBalance = recipientWallet.balance;

            await handler.revert(instance, walletRepository);
            expect(senderWallet.balance).toEqual(
                crypto.CryptoManager.LibraryManager.Libraries.BigNumber.make(senderBalance)
                    .plus(instance.data.amount)
                    .plus(instance.data.fee),
            );

            expect(senderWallet.nonce.isZero()).toBeTrue();
            expect(recipientWallet.balance).toEqual(
                crypto.CryptoManager.LibraryManager.Libraries.BigNumber.make(recipientBalance).minus(
                    instance.data.amount,
                ),
            );
        });
    });
});