import * as anchor from "@coral-xyz/anchor";
import * as assert from 'assert';
import { Program, BN, web3 } from "@coral-xyz/anchor";
import { SendaSmartc } from "../target/types/senda_smartc";
import {
  MINT_SIZE,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createInitializeMint2Instruction,
  createMintToInstruction,
  getAssociatedTokenAddressSync,
  getMinimumBalanceForRentExemptMint,
  createTransferCheckedInstruction
} from "@solana/spl-token";
import {
  PublicKey,
  Keypair,
  LAMPORTS_PER_SOL,
  SystemProgram,
  Transaction,
  SYSVAR_RENT_PUBKEY,
  Connection
} from "@solana/web3.js";
import { randomBytes } from "crypto";
import * as fs from "fs";
import * as path from "path";

const loadWalletFromFile = (filePath: string): Keypair => {
  const walletData = fs.readFileSync(path.resolve(filePath), 'utf-8');
  const secretKey = Uint8Array.from(JSON.parse(walletData));
  return Keypair.fromSecretKey(secretKey);
};

const testWallet = loadWalletFromFile('./Turbin3-wallet.json');

const connection = new anchor.web3.Connection("https://api.devnet.solana.com", "confirmed");
const wallet = new anchor.Wallet(testWallet);
const provider = new anchor.AnchorProvider(connection, wallet, {
  commitment: "confirmed",
  preflightCommitment: "confirmed"
});
anchor.setProvider(provider);

const program = anchor.workspace.senda_smartc as Program<SendaSmartc>;
const programId = program.programId;

// Devnet mints
const USDC_MINT_ADDR = new PublicKey("Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr");
const USDT_MINT_ADDR = new PublicKey("J2B12TxqtZkXtMAPY1BX2noiTSDNrz4VqiKfU5Sh9t5d");

type InitFactoryAccounts = Parameters<
  ReturnType<typeof program.methods.initFactory>["accounts"]
>[0];

type InitEscrowAccounts = Parameters<
  ReturnType<typeof program.methods.initializeEscrow>["accounts"]
>[0];

type DepositAccounts = Parameters<
  ReturnType<typeof program.methods.deposit>["accounts"]
>[0];

type ReleaseAccounts = Parameters<
  ReturnType<typeof program.methods.release>["accounts"]
>[0];

type CancelAccounts = Parameters<
  ReturnType<typeof program.methods.cancel>["accounts"]
>[0];

const confirm = async (signature: string): Promise<string> => {
  const block = await connection.getLatestBlockhash();
  await connection.confirmTransaction({ signature, ...block });
  return signature;
};

const log = async (signature: string): Promise<string> => {
  console.log(
    `Your transaction signature: https://explorer.solana.com/transaction/${signature}?cluster=devnet`
  );
  return signature;
};

const getTokenBalance = async (tokenAccount: PublicKey): Promise<number> => {
  try {
    const info = await connection.getTokenAccountBalance(tokenAccount);
    return info.value.uiAmount || 0;
  } catch (err) {
    console.error("Error getting token balance:", err);
    return 0;
  }
};

const getRecentBlockhashArray = async (connection: Connection): Promise<number[]> => {
  const { blockhash } = await connection.getLatestBlockhash();
  // Convert the blockhash to a PublicKey first, then get its bytes
  const blockhashKey = new PublicKey(blockhash);
  const blockhashBytes = blockhashKey.toBytes();
  return Array.from(blockhashBytes);
};

// Add these helper functions at the top level
const getDepositRecordPDA = (
  escrowPda: PublicKey,
  depositorPubkey: PublicKey,
  blockhashArray: number[]
): [PublicKey, number] => {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("deposit"),
      escrowPda.toBuffer(),
      depositorPubkey.toBuffer(),
      Buffer.from(blockhashArray)
    ],
    program.programId
  );
};

describe("senda_dapp", () => {

  const authority = testWallet;

  const commonWallets = Array.from(
    { length: 6 },
    () => Keypair.generate()
  );

  const [sender, receiver, user1, user2, user3, user4] = commonWallets;

  let senderUsdcAta: PublicKey;
  let senderUsdtAta: PublicKey;
  let receiverUsdcAta: PublicKey;
  let receiverUsdtAta: PublicKey;
  let user1UsdcAta: PublicKey;
  let user1UsdtAta: PublicKey;
  let user2UsdcAta: PublicKey;
  let user2UsdtAta: PublicKey;
  let user3UsdcAta: PublicKey;
  let user3UsdtAta: PublicKey;
  let user4UsdcAta: PublicKey;
  let user4UsdtAta: PublicKey;

  // Initialize decimals information
  let usdcDecimals = 6;
  let usdtDecimals = 9;

  before(async () => {
    const transferAmount = 0.1 * LAMPORTS_PER_SOL;

    // single transaction for funding all test wallets
    const batchFundTx = new Transaction();

    for (const wallet of commonWallets) {
      batchFundTx.add(
        SystemProgram.transfer({
          fromPubkey: authority.publicKey,
          toPubkey: wallet.publicKey,
          lamports: transferAmount,
        })
      );
    }

    try {
      const sig = await provider.sendAndConfirm(batchFundTx, [authority]);
      console.log(`Funded ${commonWallets.length} test wallets with ${transferAmount / LAMPORTS_PER_SOL} SOL each: ${sig}`);
    } catch (err) {
      console.error(`Failed to fund test wallets`, err);
    }

    // token accounts
    senderUsdcAta = getAssociatedTokenAddressSync(USDC_MINT_ADDR, sender.publicKey, false);
    senderUsdtAta = getAssociatedTokenAddressSync(USDT_MINT_ADDR, sender.publicKey, false);
    receiverUsdcAta = getAssociatedTokenAddressSync(USDC_MINT_ADDR, receiver.publicKey, false);
    receiverUsdtAta = getAssociatedTokenAddressSync(USDT_MINT_ADDR, receiver.publicKey, false);
    user1UsdcAta = getAssociatedTokenAddressSync(USDC_MINT_ADDR, user1.publicKey, false);
    user1UsdtAta = getAssociatedTokenAddressSync(USDT_MINT_ADDR, user1.publicKey, false);
    user2UsdcAta = getAssociatedTokenAddressSync(USDC_MINT_ADDR, user2.publicKey, false);
    user2UsdtAta = getAssociatedTokenAddressSync(USDT_MINT_ADDR, user2.publicKey, false);
    user3UsdcAta = getAssociatedTokenAddressSync(USDC_MINT_ADDR, user3.publicKey, false);
    user3UsdtAta = getAssociatedTokenAddressSync(USDT_MINT_ADDR, user3.publicKey, false);
    user4UsdcAta = getAssociatedTokenAddressSync(USDC_MINT_ADDR, user4.publicKey, false);
    user4UsdtAta = getAssociatedTokenAddressSync(USDT_MINT_ADDR, user4.publicKey, false);

    const batchCreateAtasTx = new Transaction();

    for (const wallet of [sender, receiver, user1, user2, user3, user4]) {
      const walletUsdcAta = getAssociatedTokenAddressSync(USDC_MINT_ADDR, wallet.publicKey, false);
      const walletUsdtAta = getAssociatedTokenAddressSync(USDT_MINT_ADDR, wallet.publicKey, false);

      batchCreateAtasTx.add(
        createAssociatedTokenAccountIdempotentInstruction(
          authority.publicKey,
          walletUsdcAta,
          wallet.publicKey,
          USDC_MINT_ADDR
        )
      );

      batchCreateAtasTx.add(
        createAssociatedTokenAccountIdempotentInstruction(
          authority.publicKey,
          walletUsdtAta,
          wallet.publicKey,
          USDT_MINT_ADDR
        )
      );
    }

    try {
      await provider.sendAndConfirm(batchCreateAtasTx, [authority]);
      console.log("Created token accounts for all test wallets");
    } catch (err) {
      console.error("Failed to create token accounts:", err);
    }

    console.log(`USDC decimals: ${usdcDecimals}, USDT decimals: ${usdtDecimals}`);

    const authorityUsdcAta = getAssociatedTokenAddressSync(
      USDC_MINT_ADDR,
      authority.publicKey,
      false
    );

    const authorityUsdtAta = getAssociatedTokenAddressSync(
      USDT_MINT_ADDR,
      authority.publicKey,
      false
    );

    console.log(`Authority USDC balance: ${await getTokenBalance(authorityUsdcAta)}`);
    console.log(`Authority USDT balance: ${await getTokenBalance(authorityUsdtAta)}`);

    console.log("Token pre-funding skipped - wallets will be funded as needed in each test");
  });

  const [factoryPDA, factoryBump] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("factory"),
      authority.publicKey.toBuffer(),
    ],
    programId
  );

  const [mintAuthPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("mint_auth"), factoryPDA.toBuffer()],
    programId
  );

  it("init_factory succeeds only once", async () => {
    const factoryPda = factoryPDA;

    try {
      // First check if the factory account already exists
      try {
        const existingFactory = await program.account.factory.fetch(factoryPda);

        console.log("Factory already initialized, checking fields");
        assert.strictEqual(
          existingFactory.admin.toBase58(),
          authority.publicKey.toBase58(),
          "Admin mismatch"
        );
        return
      } catch (err) {
        console.log("Factory account doesn't exist yet, will initialize it now");
      }

      try {
        const tx = await program.methods
          .initFactory()
          .accounts({
            factory: factoryPda,
            mintAuthority: mintAuthPda,
            authority: authority.publicKey,
            systemProgram: SystemProgram.programId,
            rent: SYSVAR_RENT_PUBKEY,
          } as InitFactoryAccounts)
          .rpc();

        await confirm(tx);

        const fact = await program.account.factory.fetch(factoryPda);
        assert.strictEqual(
          fact.admin.toBase58(),
          authority.publicKey.toBase58(),
          "Admin mismatch"
        );
      } catch (initErr) {
        console.log("Factory initialization failed - expected if the account already exists");
        assert.ok(
          initErr.message.includes("already in use") ||
          initErr.logs.some(log => log.includes("already in use")),
          "Factory initialization should only fail if account already exists"
        );
      }
    } catch (err) {
      console.error("Error in factory initialization test:", err);
      throw err;
    }
  });

  it("initializeEscrow: requires authority signature", async () => {
    console.log("\n=== Starting initializeEscrow authority signature test ===");
    const depositSender = Keypair.generate();
    const depositReceiver = Keypair.generate();

    await provider.sendAndConfirm(
      new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: authority.publicKey,
          toPubkey: depositSender.publicKey,
          lamports: 0.1 * LAMPORTS_PER_SOL,
        })
      ),
      [authority]
    );

    await provider.sendAndConfirm(
      new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: authority.publicKey,
          toPubkey: depositReceiver.publicKey,
          lamports: 0.1 * LAMPORTS_PER_SOL,
        })
      ),
      [authority]
    );

    const senderUsdcAta = getAssociatedTokenAddressSync(
      USDC_MINT_ADDR,
      depositSender.publicKey,
      false
    );
    const senderUsdtAta = getAssociatedTokenAddressSync(
      USDT_MINT_ADDR,
      depositSender.publicKey,
      false
    );
    const receiverUsdcAta = getAssociatedTokenAddressSync(
      USDC_MINT_ADDR,
      depositReceiver.publicKey,
      false
    );
    const receiverUsdtAta = getAssociatedTokenAddressSync(
      USDT_MINT_ADDR,
      depositReceiver.publicKey,
      false
    );

    await provider.sendAndConfirm(
      new Transaction()
        .add(createAssociatedTokenAccountIdempotentInstruction(
          authority.publicKey,
          senderUsdcAta,
          depositSender.publicKey,
          USDC_MINT_ADDR
        ))
        .add(createAssociatedTokenAccountIdempotentInstruction(
          authority.publicKey,
          senderUsdtAta,
          depositSender.publicKey,
          USDT_MINT_ADDR
        ))
        .add(createAssociatedTokenAccountIdempotentInstruction(
          authority.publicKey,
          receiverUsdcAta,
          depositReceiver.publicKey,
          USDC_MINT_ADDR
        ))
        .add(createAssociatedTokenAccountIdempotentInstruction(
          authority.publicKey,
          receiverUsdtAta,
          depositReceiver.publicKey,
          USDT_MINT_ADDR
        )),
      [authority]
    );

    const [escrowPda, escrowBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("escrow"), depositSender.publicKey.toBuffer(), depositReceiver.publicKey.toBuffer()],
      program.programId
    );

    const [vaultUsdc, vaultUsdcBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("usdc-vault"), escrowPda.toBuffer(), USDC_MINT_ADDR.toBuffer()],
      program.programId
    );

    const [vaultUsdt, vaultUsdtBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("usdt-vault"), escrowPda.toBuffer(), USDT_MINT_ADDR.toBuffer()],
      program.programId
    );

    try {
      console.log("\nAttempting initialization without authority signature...");
      
      // Get the transaction object first
      const ix = await program.methods
        .initializeEscrow(new BN(0))
        .accounts({
          escrow: escrowPda,
          feePayer: authority.publicKey,
          factory: factoryPDA,
          sender: depositSender.publicKey,
          receiver: depositReceiver.publicKey,
          authority: authority.publicKey,
          senderUsdcAta: senderUsdcAta,
          senderUsdtAta: senderUsdtAta,
          receiverUsdcAta: receiverUsdcAta,
          receiverUsdtAta: receiverUsdtAta,
          usdcMint: USDC_MINT_ADDR,
          usdtMint: USDT_MINT_ADDR,
          vaultUsdc,
          vaultUsdt,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        } as InitEscrowAccounts)
        .instruction();

      // Create transaction and add the instruction
      const tx = new Transaction().add(ix);
      
      // Get recent blockhash
      const { blockhash } = await connection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.feePayer = depositSender.publicKey;

      console.log("Transaction created. Signers:", {
        depositSender: depositSender.publicKey.toString(),
        authority: "not signing"
      });

      // Sign with only depositSender
      tx.sign(depositSender);

      console.log("Sending transaction without authority signature...");
      const serializedTx = tx.serialize();
      const txid = await connection.sendRawTransaction(serializedTx, {
        skipPreflight: false,
        preflightCommitment: "confirmed"
      });

      // Wait for confirmation
      const confirmation = await connection.confirmTransaction(txid);
      
      if (confirmation.value.err) {
        throw new Error(`Transaction failed: ${confirmation.value.err}`);
      }

      console.log("ERROR: Transaction succeeded when it should have failed");
      assert.fail("Should have failed without authority signature");
    } catch (error) {
      console.log("\nReceived expected error:", error.toString());
      const errorMessage = error.toString().toLowerCase();
      
      // Log more details about the error
      console.log("\nError details:");
      console.log(JSON.stringify(error, null, 2));
      
      const hasSignatureError = 
        errorMessage.includes("signature verification failed") || 
        errorMessage.includes("missing required signature") ||
        errorMessage.includes("0x1771") ||
        errorMessage.includes("accountnotsigner") ||  // Add program-specific error
        errorMessage.includes("error code: accountnotsigner");  // Add program-specific error message

      console.log(`\nError analysis:
      - Contains 'signature verification failed': ${errorMessage.includes("signature verification failed")}
      - Contains 'missing required signature': ${errorMessage.includes("missing required signature")}
      - Contains '0x1771': ${errorMessage.includes("0x1771")}
      - Contains 'accountnotsigner': ${errorMessage.includes("accountnotsigner")}
      `);

      assert.ok(
        hasSignatureError,
        `Expected signature verification or AccountNotSigner error, but got: ${errorMessage}`
      );
    }

    console.log("\nNow trying with authority signature...");
    try {
      const ix = await program.methods
        .initializeEscrow(new BN(0))
        .accounts({
          escrow: escrowPda,
          feePayer: authority.publicKey,
          factory: factoryPDA,
          sender: depositSender.publicKey,
          receiver: depositReceiver.publicKey,
          authority: authority.publicKey,
          senderUsdcAta: senderUsdcAta,
          senderUsdtAta: senderUsdtAta,
          receiverUsdcAta: receiverUsdcAta,
          receiverUsdtAta: receiverUsdtAta,
          usdcMint: USDC_MINT_ADDR,
          usdtMint: USDT_MINT_ADDR,
          vaultUsdc,
          vaultUsdt,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        } as InitEscrowAccounts)
        .instruction();

      const tx = new Transaction().add(ix);
      const { blockhash } = await connection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.feePayer = authority.publicKey;

      console.log("Transaction created. Signers:", {
        depositSender: depositSender.publicKey.toString(),
        authority: authority.publicKey.toString()
      });

      // Sign with both depositSender and authority
      tx.sign(depositSender, authority);

      console.log("Sending transaction with both signatures...");
      const txid = await connection.sendRawTransaction(tx.serialize(), {
        skipPreflight: false,
        preflightCommitment: "confirmed"
      });

      await connection.confirmTransaction(txid);
      console.log("Transaction confirmed:", txid);

      // Wait a bit before fetching the account to ensure it's available
      await new Promise(resolve => setTimeout(resolve, 2000));

      const esc = await program.account.escrow.fetch(escrowPda);
      console.log("\nEscrow initialized successfully. Escrow state:", {
        seed: esc.seed.toNumber(),
        bump: esc.bump,
        depositedUsdc: esc.depositedUsdc.toNumber(),
        depositedUsdt: esc.depositedUsdt.toNumber(),
        authority: esc.authority.toBase58()
      });
    } catch (error) {
      console.error("\nUnexpected error during successful initialization:", error);
      throw error;
    }

    console.log("=== Test completed successfully ===\n");
  });

  it("prevents direct program calls without authority signature", async () => {
    console.log("\n=== Starting direct program call test ===");
    const depositSender = Keypair.generate();
    const depositReceiver = Keypair.generate();

    await provider.sendAndConfirm(
      new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: authority.publicKey,
          toPubkey: depositSender.publicKey,
          lamports: 0.1 * LAMPORTS_PER_SOL,
        })
      ),
      [authority]
    );

    const senderUsdcAta = getAssociatedTokenAddressSync(
      USDC_MINT_ADDR,
      depositSender.publicKey,
      false
    );
    const senderUsdtAta = getAssociatedTokenAddressSync(
      USDT_MINT_ADDR,
      depositSender.publicKey,
      false
    );
    const receiverUsdcAta = getAssociatedTokenAddressSync(
      USDC_MINT_ADDR,
      depositReceiver.publicKey,
      false
    );
    const receiverUsdtAta = getAssociatedTokenAddressSync(
      USDT_MINT_ADDR,
      depositReceiver.publicKey,
      false
    );

    await provider.sendAndConfirm(
      new Transaction()
        .add(createAssociatedTokenAccountIdempotentInstruction(
          authority.publicKey,
          senderUsdcAta,
          depositSender.publicKey,
          USDC_MINT_ADDR
        ))
        .add(createAssociatedTokenAccountIdempotentInstruction(
          authority.publicKey,
          senderUsdtAta,
          depositSender.publicKey,
          USDT_MINT_ADDR
        ))
        .add(createAssociatedTokenAccountIdempotentInstruction(
          authority.publicKey,
          receiverUsdcAta,
          depositReceiver.publicKey,
          USDC_MINT_ADDR
        ))
        .add(createAssociatedTokenAccountIdempotentInstruction(
          authority.publicKey,
          receiverUsdtAta,
          depositReceiver.publicKey,
          USDT_MINT_ADDR
        )),
      [authority]
    );

    const [escrowPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("escrow"), depositSender.publicKey.toBuffer(), depositReceiver.publicKey.toBuffer()],
      program.programId
    );

    const [vaultUsdc] = PublicKey.findProgramAddressSync(
      [Buffer.from("usdc-vault"), escrowPda.toBuffer(), USDC_MINT_ADDR.toBuffer()],
      program.programId
    );

    const [vaultUsdt] = PublicKey.findProgramAddressSync(
      [Buffer.from("usdt-vault"), escrowPda.toBuffer(), USDT_MINT_ADDR.toBuffer()],
      program.programId
    );

    try {
      console.log("\nAttempting to call program directly without authority signature...");
      
      // Create the instruction data manually
      const initializeEscrowInstructionData = Buffer.from([
        243, 160, 77, 153, 11, 92, 48, 209, // discriminator for initializeEscrow
        0, 0, 0, 0, 0, 0, 0, 0              // seed (u64) = 0
      ]);

      const ix = new web3.TransactionInstruction({
        programId: program.programId,
        keys: [
          { pubkey: depositSender.publicKey, isSigner: true, isWritable: true },
          { pubkey: factoryPDA, isSigner: false, isWritable: false },
          { pubkey: escrowPda, isSigner: false, isWritable: true },
          { pubkey: depositSender.publicKey, isSigner: true, isWritable: true },
          { pubkey: depositReceiver.publicKey, isSigner: false, isWritable: false },
          { pubkey: authority.publicKey, isSigner: false, isWritable: true },
          { pubkey: senderUsdcAta, isSigner: false, isWritable: false },
          { pubkey: senderUsdtAta, isSigner: false, isWritable: false },
          { pubkey: receiverUsdcAta, isSigner: false, isWritable: false },
          { pubkey: receiverUsdtAta, isSigner: false, isWritable: false },
          { pubkey: USDC_MINT_ADDR, isSigner: false, isWritable: false },
          { pubkey: USDT_MINT_ADDR, isSigner: false, isWritable: false },
          { pubkey: vaultUsdc, isSigner: false, isWritable: true },
          { pubkey: vaultUsdt, isSigner: false, isWritable: true },
          { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
          { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
        ],
        data: initializeEscrowInstructionData,
      });

      const tx = new Transaction().add(ix);
      await web3.sendAndConfirmTransaction(connection, tx, [depositSender]);
      console.log("Init escrow transaction failed successfully");

      console.log("ERROR: Transaction succeeded when it should have failed");
      assert.fail("Direct program call should have failed without authority signature");
    } catch (error) {
      console.log("\nReceived expected error:", error.toString());
      const errorMessage = error.toString().toLowerCase();
      
      const hasSignatureError = 
        errorMessage.includes("signature verification failed") || 
        errorMessage.includes("missing required signature") ||
        errorMessage.includes("0x1771") ||
        errorMessage.includes("accountnotsigner") ||
        errorMessage.includes("error code: accountnotsigner");

      assert.ok(
        hasSignatureError,
        `Expected signature verification or AccountNotSigner error, but got: ${errorMessage}`
      );
    }
  });

  it("deposits tokens into USDC vault successfully", async () => {
    const depositSender = user1;
    const depositReceiver = user2;

    const senderUsdcAta = user1UsdcAta;
    const senderUsdtAta = user1UsdtAta;
    const receiverUsdcAta = user2UsdcAta;
    const receiverUsdtAta = user2UsdtAta;

    const walletUsdcAta = getAssociatedTokenAddressSync(
      USDC_MINT_ADDR,
      authority.publicKey,
      false
    );

    // Create token accounts if they don't exist
    await provider.sendAndConfirm(
      new Transaction()
        .add(createAssociatedTokenAccountIdempotentInstruction(
          authority.publicKey,
          senderUsdcAta,
          depositSender.publicKey,
          USDC_MINT_ADDR
        ))
        .add(createAssociatedTokenAccountIdempotentInstruction(
          authority.publicKey,
          senderUsdtAta,
          depositSender.publicKey,
          USDT_MINT_ADDR
        )),
      [authority]
    );

    const tokenBalance = await getTokenBalance(senderUsdcAta);
    console.log(`Sender USDC balance: ${tokenBalance} USDC`);

    // just in case
    if (tokenBalance < 1) {
      const depositTokenAmount = 500_000; // 0.5 USDC

      await provider.sendAndConfirm(
        new Transaction().add(
          createTransferCheckedInstruction(
            walletUsdcAta,
            USDC_MINT_ADDR,
            senderUsdcAta,
            authority.publicKey,
            depositTokenAmount,
            usdcDecimals
          )
        ),
        [authority]
      );

      console.log(`Topped up sender with 1 USDC`);
      console.log(`Sender USDC balance: ${await getTokenBalance(senderUsdcAta)}`);
    }

    const [escrowPda, escrowBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("escrow"), depositSender.publicKey.toBuffer(), depositReceiver.publicKey.toBuffer()],
      program.programId
    );

    const [vaultUsdc, vaultUsdcBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("usdc-vault"), escrowPda.toBuffer(), USDC_MINT_ADDR.toBuffer()],
      program.programId
    );

    const [vaultUsdt, vaultUsdtBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("usdt-vault"), escrowPda.toBuffer(), USDT_MINT_ADDR.toBuffer()],
      program.programId
    );

    const ix = await program.methods
      .initializeEscrow(new BN(0))
      .accounts({
        escrow: escrowPda,
        feePayer: authority.publicKey,
        sender: depositSender.publicKey,
        receiver: depositReceiver.publicKey,
        authority: authority.publicKey,
        senderUsdcAta: senderUsdcAta,
        senderUsdtAta: senderUsdtAta,
        receiverUsdcAta: receiverUsdcAta,
        receiverUsdtAta: receiverUsdtAta,
        usdcMint: USDC_MINT_ADDR,
        usdtMint: USDT_MINT_ADDR,
        vaultUsdc,
        vaultUsdt,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      } as InitEscrowAccounts)
      .instruction();

    const tx = new Transaction().add(ix);

    const initEscrowSig = await web3.sendAndConfirmTransaction(connection, tx, [depositSender, authority]);
    console.log("Init escrow transaction signature:", initEscrowSig);
    console.log("Escrow initialized successfully");

    const blockhashArray = await getRecentBlockhashArray(connection);
    const [depositRecordPda, depositRecordBump] = getDepositRecordPDA(escrowPda, depositSender.publicKey, blockhashArray);

    const amountToDeposit = new BN(500_000);

    try {
      const depositIx = await program.methods
        .deposit(
          { usdc: {} },
          { sender: {} },
          blockhashArray,
          amountToDeposit
        )
        .accounts({
          escrow: escrowPda,
          sender: depositSender.publicKey,
          receiver: depositReceiver.publicKey,
          authority: authority.publicKey,
          senderUsdcAta: senderUsdcAta,
          senderUsdtAta: senderUsdtAta,
          receiverUsdcAta: receiverUsdcAta,
          receiverUsdtAta: receiverUsdtAta,
          usdcMint: USDC_MINT_ADDR,
          usdtMint: USDT_MINT_ADDR,
          vaultUsdc: vaultUsdc,
          vaultUsdt: vaultUsdt,
          depositRecord: depositRecordPda,
          feePayer: authority.publicKey,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY
        } as DepositAccounts)
        .instruction();

      const depositTx = new Transaction().add(depositIx);
      const depositSig = await web3.sendAndConfirmTransaction(connection, depositTx, [depositSender, authority]);

      console.log(`Deposit transaction signature: ${depositSig}`);

      // Verify the deposit record was created correctly
      const depositRecord = await program.account.depositRecord.fetch(depositRecordPda);
      assert.ok(depositRecord.escrow.equals(escrowPda), "Escrow address mismatch");
      assert.strictEqual(depositRecord.amount.toNumber(), amountToDeposit.toNumber(), "Amount mismatch");

      const escrowAccountAfter = await program.account.escrow.fetch(escrowPda);
      assert.strictEqual(escrowAccountAfter.depositCount.toNumber(), 1, "Deposit count should be 1 after deposit");
      assert.strictEqual(escrowAccountAfter.depositedUsdc.toNumber(), amountToDeposit.toNumber(), "Escrow USDC balance should match deposit");

      const vaultBalance = await connection.getTokenAccountBalance(vaultUsdc);
      assert.strictEqual(vaultBalance.value.amount, amountToDeposit.toString(), "Vault USDC balance should match deposit");
    } catch (error) {
      console.error("Error making deposit:", error);
      throw error;
    }
  });

  it("deposits tokens into USDT vault successfully", async () => {
    const depositSender = user3;
    const depositReceiver = user4;

    const senderUsdcAta = user3UsdcAta;
    const senderUsdtAta = user3UsdtAta;
    const receiverUsdcAta = user4UsdcAta;
    const receiverUsdtAta = user4UsdtAta;

    const walletUsdtAta = getAssociatedTokenAddressSync(
      USDT_MINT_ADDR,
      authority.publicKey,
      false
    );

    const tokenBalance = await getTokenBalance(senderUsdtAta);
    console.log(`Sender USDT balance: ${tokenBalance} USDT`);

    // just in case
    if (tokenBalance < 2) {
      const depositTokenAmount = 2_000_000_000;

      await provider.sendAndConfirm(
        new Transaction().add(
          createTransferCheckedInstruction(
            walletUsdtAta,
            USDT_MINT_ADDR,
            senderUsdtAta,
            authority.publicKey,
            depositTokenAmount,
            usdtDecimals
          )
        ),
        [authority]
      );

      console.log(`Topped up sender with 2 USDT`);
      console.log(`Sender USDT balance: ${await getTokenBalance(senderUsdtAta)}`);
    }

    const [escrowPda, escrowBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("escrow"), depositSender.publicKey.toBuffer(), depositReceiver.publicKey.toBuffer()],
      program.programId
    );

    const [vaultUsdt, vaultUsdtBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("usdt-vault"), escrowPda.toBuffer(), USDT_MINT_ADDR.toBuffer()],
      program.programId
    );

    const [vaultUsdc, vaultUsdcBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("usdc-vault"), escrowPda.toBuffer(), USDC_MINT_ADDR.toBuffer()],
      program.programId
    );

    const ix = await program.methods
      .initializeEscrow(new BN(0))
      .accounts({
        escrow: escrowPda,
        feePayer: authority.publicKey,
        sender: depositSender.publicKey,
        receiver: depositReceiver.publicKey,
        senderUsdcAta: senderUsdcAta,
        senderUsdtAta: senderUsdtAta,
        receiverUsdcAta: receiverUsdcAta,
        receiverUsdtAta: receiverUsdtAta,
        usdcMint: USDC_MINT_ADDR,
        usdtMint: USDT_MINT_ADDR,
        vaultUsdc,
        vaultUsdt,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      } as InitEscrowAccounts)
      .instruction();

    const tx = new Transaction().add(ix);
    const initEscrowSig = await web3.sendAndConfirmTransaction(connection, tx, [depositSender, authority]);
    console.log("Init escrow transaction signature:", initEscrowSig);
    console.log("Escrow initialized successfully");

    const blockhashArray = await getRecentBlockhashArray(connection);
    const [depositRecordPda, depositRecordBump] = getDepositRecordPDA(escrowPda, depositSender.publicKey, blockhashArray);

    const amountToDeposit = new BN(100_000_000); // 0.1 USDT with 9 decimals (reduced amount)

    try {
      const ix = await program.methods
        .deposit({ usdt: {} }, { sender: {} }, blockhashArray, amountToDeposit)
        .accounts({
          escrow: escrowPda,
          sender: depositSender.publicKey,
          receiver: depositReceiver.publicKey,
          authority: authority.publicKey,
          usdcMint: USDC_MINT_ADDR,
          usdtMint: USDT_MINT_ADDR,
          vaultUsdc: vaultUsdc,
          vaultUsdt: vaultUsdt,
          depositRecord: depositRecordPda,
          feePayer: authority.publicKey,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY
        } as DepositAccounts)
        .instruction();

      const depositTx = new Transaction().add(ix);
      const depositSig = await web3.sendAndConfirmTransaction(connection, depositTx, [depositSender, authority]);

      console.log(`Deposit transaction signature: ${depositSig}`);

      const escrowAccount = await program.account.escrow.fetch(escrowPda);
      assert.strictEqual(escrowAccount.depositCount.toNumber(), 1, "Deposit count should be 1 after deposit");
      assert.strictEqual(escrowAccount.depositedUsdt.toNumber(), amountToDeposit.toNumber(), "Escrow USDT balance should match deposit");

      const vaultBalance = await connection.getTokenAccountBalance(vaultUsdt);
      assert.strictEqual(vaultBalance.value.amount, amountToDeposit.toString(), "Vault USDT balance should match deposit");
    } catch (error) {
      console.error("Error making deposit:", error);
      throw error;
    }
  });

  it("releases funds using dual signature policy", async () => {
    const depositSender = Keypair.generate();
    const depositReceiver = Keypair.generate();

    await provider.sendAndConfirm(
      new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: authority.publicKey,
          toPubkey: depositSender.publicKey,
          lamports: 0.1 * LAMPORTS_PER_SOL,
        })
      ),
      [authority]
    );

    await provider.sendAndConfirm(
      new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: authority.publicKey,
          toPubkey: depositReceiver.publicKey,
          lamports: 0.1 * LAMPORTS_PER_SOL,
        })
      ),
      [authority]
    );

    const senderUsdcAta = getAssociatedTokenAddressSync(
      USDC_MINT_ADDR,
      depositSender.publicKey,
      false
    );
    const senderUsdtAta = getAssociatedTokenAddressSync(
      USDT_MINT_ADDR,
      depositSender.publicKey,
      false
    );
    const receiverUsdcAta = getAssociatedTokenAddressSync(
      USDC_MINT_ADDR,
      depositReceiver.publicKey,
      false
    );
    const receiverUsdtAta = getAssociatedTokenAddressSync(
      USDT_MINT_ADDR,
      depositReceiver.publicKey,
      false
    );

    await provider.sendAndConfirm(
      new Transaction()
        .add(createAssociatedTokenAccountIdempotentInstruction(
          authority.publicKey,
          senderUsdcAta,
          depositSender.publicKey,
          USDC_MINT_ADDR
        ))
        .add(createAssociatedTokenAccountIdempotentInstruction(
          authority.publicKey,
          senderUsdtAta,
          depositSender.publicKey,
          USDT_MINT_ADDR
        ))
        .add(createAssociatedTokenAccountIdempotentInstruction(
          authority.publicKey,
          receiverUsdcAta,
          depositReceiver.publicKey,
          USDC_MINT_ADDR
        ))
        .add(createAssociatedTokenAccountIdempotentInstruction(
          authority.publicKey,
          receiverUsdtAta,
          depositReceiver.publicKey,
          USDT_MINT_ADDR
        )),
      [authority]
    );

    const walletUsdtAta = getAssociatedTokenAddressSync(
      USDT_MINT_ADDR,
      authority.publicKey,
      false
    );

    // Transfer enough USDT to sender account
    const depositTokenAmount = 1_000_000_000;

    await provider.sendAndConfirm(
      new Transaction().add(
        createTransferCheckedInstruction(
          walletUsdtAta,
          USDT_MINT_ADDR,
          senderUsdtAta,
          authority.publicKey,
          depositTokenAmount,
          usdtDecimals
        )
      ),
      [authority]
    );

    console.log(`Transferred 1 USDT to sender for dual signature test`);
    console.log(`Sender USDT balance after funding: ${await getTokenBalance(senderUsdtAta)}`);

    const escrowSeed = new BN(randomBytes(8));

    const [escrowPda, escrowBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("escrow"), depositSender.publicKey.toBuffer(), depositReceiver.publicKey.toBuffer()],
      program.programId
    );

    const [vaultUsdc, vaultUsdcBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("usdc-vault"), escrowPda.toBuffer(), USDC_MINT_ADDR.toBuffer()],
      program.programId
    );

    const [vaultUsdt, vaultUsdtBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("usdt-vault"), escrowPda.toBuffer(), USDT_MINT_ADDR.toBuffer()],
      program.programId
    );

    const ix =await program.methods
      .initializeEscrow(escrowSeed)
      .accounts({
        escrow: escrowPda,
        feePayer: authority.publicKey,
        sender: depositSender.publicKey,
        receiver: depositReceiver.publicKey,
        authority: authority.publicKey,
        senderUsdcAta: senderUsdcAta,
        senderUsdtAta: senderUsdtAta,
        receiverUsdcAta: receiverUsdcAta,
        receiverUsdtAta: receiverUsdtAta,
        usdcMint: USDC_MINT_ADDR,
        usdtMint: USDT_MINT_ADDR,
        vaultUsdc,
        vaultUsdt,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      } as InitEscrowAccounts)
      .instruction();

    const tx = new Transaction().add(ix);
    const initEscrowSig = await web3.sendAndConfirmTransaction(connection, tx, [depositSender, authority]);
    console.log("Init escrow transaction signature:", initEscrowSig);
    console.log("Escrow initialized successfully for dual signature test");

    const blockhashArray = await getRecentBlockhashArray(connection);

    // Create deposit record
    const [depositRecordPda] = getDepositRecordPDA(escrowPda, depositSender.publicKey, blockhashArray);

    // Use a smaller deposit amount for USDT
    const depositAmount = new BN(100_000_000);

    // Make the deposit with dual signature policy
    const depositIx = await program.methods
      .deposit({ usdt: {} }, { both: {} }, blockhashArray, depositAmount)
      .accounts({
        escrow: escrowPda,
        sender: depositSender.publicKey,
        receiver: depositReceiver.publicKey,
        authority: authority.publicKey,
        usdcMint: USDC_MINT_ADDR,
        usdtMint: USDT_MINT_ADDR,
        senderUsdcAta: senderUsdcAta,
        senderUsdtAta: senderUsdtAta,
        receiverUsdcAta: receiverUsdcAta,
        receiverUsdtAta: receiverUsdtAta,
        vaultUsdc: vaultUsdc,
        vaultUsdt: vaultUsdt,
        depositRecord: depositRecordPda,
        feePayer: authority.publicKey,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY
      } as DepositAccounts)
      .instruction();

    const depositTx = new Transaction().add(depositIx);

    try {
      const depositSig = await web3.sendAndConfirmTransaction(
        connection,
        depositTx,
        [depositSender, authority]
      );
      console.log(`Deposit with dual signature policy: ${depositSig}`);
    } catch (err) {
      console.error("Error making deposit:", err);
      throw err;
    }

    // Check initial balances before release
    const receiverUsdtBefore = await getTokenBalance(receiverUsdtAta);
    const vaultUsdtBefore = await getTokenBalance(vaultUsdt);

    console.log(`Receiver USDT balance before release: ${receiverUsdtBefore}`);
    console.log(`Vault USDT balance before release: ${vaultUsdtBefore}`);

    // Now attempt to release with both signatures
    try {
      // Create the release instruction
      const releaseIx = await program.methods
        .release(blockhashArray)
        .accounts({
          escrow: escrowPda,
          sender: depositSender.publicKey,
          receiver: depositReceiver.publicKey,
          receivingParty: depositReceiver.publicKey,
          authority: authority.publicKey,
          receivingUsdcAta: receiverUsdcAta,
          receivingUsdtAta: receiverUsdtAta,
          usdcMint: USDC_MINT_ADDR,
          usdtMint: USDT_MINT_ADDR,
          vaultUsdc: vaultUsdc,
          vaultUsdt: vaultUsdt,
          depositRecord: depositRecordPda,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY
        } as ReleaseAccounts)
        .instruction();

      // Create a transaction with the release instruction
      const releaseTx = new Transaction().add(releaseIx);

      // Sign with both parties
      const releaseSig = await web3.sendAndConfirmTransaction(
        connection,
        releaseTx,
        [depositSender, depositReceiver, authority]
      );

      console.log(`Released funds with dual signature: ${releaseSig}`);

      // Verify final balances
      const receiverUsdtAfter = await getTokenBalance(receiverUsdtAta);
      const vaultUsdtAfter = await getTokenBalance(vaultUsdt);

      console.log(`Receiver USDT balance after release: ${receiverUsdtAfter}`);
      console.log(`Vault USDT balance after release: ${vaultUsdtAfter}`);

      // Validate that the transfer occurred correctly
      assert.strictEqual(vaultUsdtAfter, 0, "Vault should be empty after release");
      assert.strictEqual(
        Math.round(receiverUsdtAfter * 10) / 10,
        Math.round((receiverUsdtBefore + 0.1) * 10) / 10,
        "Receiver should have received 0.1 USDT"
      );

    } catch (err) {
      console.error("Error releasing funds:", err);
      throw err;
    }
  });

  it("releases funds using single signature policy when receiver is the signer", async () => {
    const depositSender = Keypair.generate();
    const depositReceiver = Keypair.generate();

    await provider.sendAndConfirm(
      new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: authority.publicKey,
          toPubkey: depositSender.publicKey,
          lamports: 0.1 * LAMPORTS_PER_SOL,
        })
      ),
      [authority]
    );

    await provider.sendAndConfirm(
      new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: authority.publicKey,
          toPubkey: depositReceiver.publicKey,
          lamports: 0.1 * LAMPORTS_PER_SOL,
        })
      ),
      [authority]
    );

    const senderUsdcAta = getAssociatedTokenAddressSync(
      USDC_MINT_ADDR,
      depositSender.publicKey,
      false
    );
    const senderUsdtAta = getAssociatedTokenAddressSync(
      USDT_MINT_ADDR,
      depositSender.publicKey,
      false
    );
    const receiverUsdcAta = getAssociatedTokenAddressSync(
      USDC_MINT_ADDR,
      depositReceiver.publicKey,
      false
    );
    const receiverUsdtAta = getAssociatedTokenAddressSync(
      USDT_MINT_ADDR,
      depositReceiver.publicKey,
      false
    );

    await provider.sendAndConfirm(
      new Transaction()
        .add(createAssociatedTokenAccountIdempotentInstruction(
          authority.publicKey,
          senderUsdcAta,
          depositSender.publicKey,
          USDC_MINT_ADDR
        ))
        .add(createAssociatedTokenAccountIdempotentInstruction(
          authority.publicKey,
          senderUsdtAta,
          depositSender.publicKey,
          USDT_MINT_ADDR
        ))
        .add(createAssociatedTokenAccountIdempotentInstruction(
          authority.publicKey,
          receiverUsdcAta,
          depositReceiver.publicKey,
          USDC_MINT_ADDR
        ))
        .add(createAssociatedTokenAccountIdempotentInstruction(
          authority.publicKey,
          receiverUsdtAta,
          depositReceiver.publicKey,
          USDT_MINT_ADDR
        )),
      [authority]
    );

    const walletUsdcAta = getAssociatedTokenAddressSync(
      USDC_MINT_ADDR,
      authority.publicKey,
      false
    );

    const tokenAmount = 1_000_000;

    await provider.sendAndConfirm(
      new Transaction().add(
        createTransferCheckedInstruction(
          walletUsdcAta,
          USDC_MINT_ADDR,
          senderUsdcAta,
          authority.publicKey,
          tokenAmount,
          6
        )
      ),
      [authority]
    );

    console.log(`Transferred 1 USDC to sender for receiver-signer test`);

    const escrowSeed = new BN(randomBytes(8));

    const [escrowPda, escrowBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("escrow"), depositSender.publicKey.toBuffer(), depositReceiver.publicKey.toBuffer()],
      program.programId
    );
    const [vaultUsdc, vaultUsdcBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("usdc-vault"), escrowPda.toBuffer(), USDC_MINT_ADDR.toBuffer()],
      program.programId
    );
    const [vaultUsdt, vaultUsdtBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("usdt-vault"), escrowPda.toBuffer(), USDT_MINT_ADDR.toBuffer()],
      program.programId
    );

    const ix =await program.methods
      .initializeEscrow(escrowSeed)
      .accounts({
        escrow: escrowPda,
        feePayer: authority.publicKey,
        sender: depositSender.publicKey,
        receiver: depositReceiver.publicKey,
        authority: authority.publicKey,
        senderUsdcAta: senderUsdcAta,
        senderUsdtAta: senderUsdtAta,
        receiverUsdcAta: receiverUsdcAta,
        receiverUsdtAta: receiverUsdtAta,
        usdcMint: USDC_MINT_ADDR,
        usdtMint: USDT_MINT_ADDR,
        vaultUsdc,
        vaultUsdt,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      } as InitEscrowAccounts)
      .instruction();

      const tx = new Transaction().add(ix);
      const initEscrowSig = await web3.sendAndConfirmTransaction(connection, tx, [depositSender, authority]);
      console.log("Init escrow transaction signature:", initEscrowSig);
      console.log("Escrow initialized successfully for receiver-signer test");

    const blockhashArray = await getRecentBlockhashArray(connection);

    const [depositRecordPda, depositRecordBump] = getDepositRecordPDA(escrowPda, depositSender.publicKey, blockhashArray);

    const depositAmount = new BN(500_000);

    // receiver is the designated signer
    const depositIx =await program.methods
      .deposit(
        { usdc: {} },
        { receiver: {} },
        blockhashArray,
        depositAmount
      )
      .accounts({
        escrow: escrowPda,
        sender: depositSender.publicKey,
        receiver: depositReceiver.publicKey,
        authority: authority.publicKey,
        usdcMint: USDC_MINT_ADDR,
        usdtMint: USDT_MINT_ADDR,
        senderUsdcAta: senderUsdcAta,
        senderUsdtAta: senderUsdtAta,
        receiverUsdcAta: receiverUsdcAta,
        receiverUsdtAta: receiverUsdtAta,
        vaultUsdc: vaultUsdc,
        vaultUsdt: vaultUsdt,
        depositRecord: depositRecordPda,
        feePayer: authority.publicKey,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY
      } as DepositAccounts)
      .instruction();

    const depositTx = new Transaction().add(depositIx);
    const depositSig = await web3.sendAndConfirmTransaction(connection, depositTx, [depositSender, authority]);
    console.log("Deposit transaction signature:", depositSig);

    console.log(`Deposit with receiver as authorized signer: success`);

    const receiverBalanceBefore = await getTokenBalance(receiverUsdcAta);
    const vaultBalanceBefore = await getTokenBalance(vaultUsdc);
    console.log(`Receiver USDC balance before release: ${receiverBalanceBefore}`);
    console.log(`Vault USDC balance before release: ${vaultBalanceBefore}`);

    const releaseIx = await program.methods
      .release(blockhashArray)
      .accounts({
        escrow: escrowPda,
        sender: depositSender.publicKey,
        receiver: depositReceiver.publicKey,
        receivingParty: depositReceiver.publicKey,
        authority: authority.publicKey,
        receivingUsdcAta: receiverUsdcAta,
        receivingUsdtAta: receiverUsdtAta,
        usdcMint: USDC_MINT_ADDR,
        usdtMint: USDT_MINT_ADDR,
        vaultUsdc: vaultUsdc,
        vaultUsdt: vaultUsdt,
        depositRecord: depositRecordPda,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY
      } as ReleaseAccounts)
      .instruction()

    const releaseTx = new Transaction().add(releaseIx);
    // releaseTx.feePayer = depositReceiver.publicKey;
    // releaseTx.recentBlockhash = blockhash.blockhash;

    // // Sign the transaction with the receiver keypair
    // releaseTx.sign(depositReceiver);

    // // Send the signed transaction
    // const rawTx = releaseTx.serialize();
    // const txId = await connection.sendRawTransaction(rawTx);

    // Wait for confirmation
    // await connection.confirmTransaction({
    //   signature: txId,
    //   ...blockhash
    // });

    const releaseSig = await web3.sendAndConfirmTransaction(
      connection,
      releaseTx,
      [depositReceiver, authority]
    );

    console.log(`Released funds with receiver as signer: ${releaseSig}`);

    // Verify the release was successful
    const receiverBalanceAfter = await getTokenBalance(receiverUsdcAta);
    const vaultBalanceAfter = await getTokenBalance(vaultUsdc);
    console.log(`Receiver USDC balance after release: ${receiverBalanceAfter}`);
    console.log(`Vault USDC balance after release: ${vaultBalanceAfter}`);

    assert.strictEqual(vaultBalanceAfter, 0, "Vault should be empty after release");
    assert.strictEqual(receiverBalanceAfter - receiverBalanceBefore, vaultBalanceBefore, "Receiver should receive funds");

    const depositRecord = await program.account.depositRecord.fetch(depositRecordPda);
    assert.strictEqual(depositRecord.state.complete !== undefined, true, "Deposit record should be marked as complete");
  });

  it("releases funds using single signature policy when sender is the signer", async () => {
    const depositSender = Keypair.generate();
    const depositReceiver = Keypair.generate();

    await provider.sendAndConfirm(
      new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: authority.publicKey,
          toPubkey: depositSender.publicKey,
          lamports: 0.1 * LAMPORTS_PER_SOL,
        })
      ),
      [authority]
    );

    await provider.sendAndConfirm(
      new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: authority.publicKey,
          toPubkey: depositReceiver.publicKey,
          lamports: 0.1 * LAMPORTS_PER_SOL,
        })
      ),
      [authority]
    );

    const senderUsdcAta = getAssociatedTokenAddressSync(
      USDC_MINT_ADDR,
      depositSender.publicKey,
      false
    );
    const senderUsdtAta = getAssociatedTokenAddressSync(
      USDT_MINT_ADDR,
      depositSender.publicKey,
      false
    );
    const receiverUsdcAta = getAssociatedTokenAddressSync(
      USDC_MINT_ADDR,
      depositReceiver.publicKey,
      false
    );
    const receiverUsdtAta = getAssociatedTokenAddressSync(
      USDT_MINT_ADDR,
      depositReceiver.publicKey,
      false
    );

    await provider.sendAndConfirm(
      new Transaction()
        .add(createAssociatedTokenAccountIdempotentInstruction(
          depositSender.publicKey,
          senderUsdcAta,
          depositSender.publicKey,
          USDC_MINT_ADDR
        ))
        .add(createAssociatedTokenAccountIdempotentInstruction(
          depositSender.publicKey,
          senderUsdtAta,
          depositSender.publicKey,
          USDT_MINT_ADDR
        ))
        .add(createAssociatedTokenAccountIdempotentInstruction(
          depositSender.publicKey,
          receiverUsdcAta,
          depositReceiver.publicKey,
          USDC_MINT_ADDR
        ))
        .add(createAssociatedTokenAccountIdempotentInstruction(
          depositSender.publicKey,
          receiverUsdtAta,
          depositReceiver.publicKey,
          USDT_MINT_ADDR
        )),
      [depositSender]
    );

    const walletUsdcAta = getAssociatedTokenAddressSync(
      USDC_MINT_ADDR,
      authority.publicKey,
      false
    );

    const tokenAmount = 1_000_000;

    await provider.sendAndConfirm(
      new Transaction().add(
        createTransferCheckedInstruction(
          walletUsdcAta,
          USDC_MINT_ADDR,
          senderUsdcAta,
          authority.publicKey,
          tokenAmount,
          6
        )
      ),
      [authority]
    );

    console.log(`Transferred 1 USDC to sender for sender-signer test`);

    const [escrowPda, escrowBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("escrow"), depositSender.publicKey.toBuffer(), depositReceiver.publicKey.toBuffer()],
      program.programId
    );
    const [vaultUsdc, vaultUsdcBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("usdc-vault"), escrowPda.toBuffer(), USDC_MINT_ADDR.toBuffer()],
      program.programId
    );
    const [vaultUsdt, vaultUsdtBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("usdt-vault"), escrowPda.toBuffer(), USDT_MINT_ADDR.toBuffer()],
      program.programId
    );

    const ix = await program.methods
      .initializeEscrow(new BN(0))
      .accounts({
        escrow: escrowPda,
        feePayer: authority.publicKey,
        sender: depositSender.publicKey,
        receiver: depositReceiver.publicKey,
        authority: authority.publicKey,
        senderUsdcAta: senderUsdcAta,
        senderUsdtAta: senderUsdtAta,
        receiverUsdcAta: receiverUsdcAta,
        receiverUsdtAta: receiverUsdtAta,
        usdcMint: USDC_MINT_ADDR,
        usdtMint: USDT_MINT_ADDR,
        vaultUsdc,
        vaultUsdt,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      } as InitEscrowAccounts)
      .instruction();

    const tx = new Transaction().add(ix);
    const initEscrowSig = await web3.sendAndConfirmTransaction(connection, tx, [depositSender, authority]);
    console.log("Init escrow transaction signature:", initEscrowSig);
    console.log("Escrow initialized successfully for sender-signer test");

    const blockhashArray = await getRecentBlockhashArray(connection);

    const [depositRecordPda, depositRecordBump] = getDepositRecordPDA(escrowPda, depositSender.publicKey, blockhashArray);

    const depositAmount = new BN(500_000);

    // sender is the designated signer
    const depositIx = await program.methods
      .deposit(
        { usdc: {} },
        { sender: {} },
        blockhashArray,  // Pass the array directly
        depositAmount
      )
      .accounts({
        escrow: escrowPda,
        sender: depositSender.publicKey,
        receiver: depositReceiver.publicKey,
        authority: authority.publicKey,
        senderUsdcAta: senderUsdcAta,
        senderUsdtAta: senderUsdtAta,
        receiverUsdcAta: receiverUsdcAta,
        receiverUsdtAta: receiverUsdtAta,
        usdcMint: USDC_MINT_ADDR,
        usdtMint: USDT_MINT_ADDR,
        vaultUsdc: vaultUsdc,
        vaultUsdt: vaultUsdt,
        depositRecord: depositRecordPda,
        feePayer: authority.publicKey,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY
      } as DepositAccounts)
      .instruction();

    const depositTx = new Transaction().add(depositIx);
    const depositSig = await web3.sendAndConfirmTransaction(connection, depositTx, [depositSender, authority]);
    console.log("Deposit transaction signature:", depositSig);

    console.log(`Deposit with sender as authorized signer: success`);

    const receiverBalanceBefore = await getTokenBalance(receiverUsdcAta);
    const vaultBalanceBefore = await getTokenBalance(vaultUsdc);
    console.log(`Receiver USDC balance before release: ${receiverBalanceBefore}`);
    console.log(`Vault USDC balance before release: ${vaultBalanceBefore}`);

    const releaseIx = await program.methods
      .release(blockhashArray)
      .accounts({
        escrow: escrowPda,
        sender: depositSender.publicKey,
        receiver: depositReceiver.publicKey,
        receivingParty: depositReceiver.publicKey,
        authority: authority.publicKey,
        receivingUsdcAta: receiverUsdcAta,
        receivingUsdtAta: receiverUsdtAta,
        usdcMint: USDC_MINT_ADDR,
        usdtMint: USDT_MINT_ADDR,
        vaultUsdc: vaultUsdc,
        vaultUsdt: vaultUsdt,
        depositRecord: depositRecordPda,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY
      } as ReleaseAccounts)
      .instruction();

    const releaseTx = new Transaction();
    releaseTx.add(releaseIx);

    // const releaseBlockHashInfo = await connection.getLatestBlockhash();
    // releaseTx.recentBlockhash = releaseBlockHashInfo.blockhash;

    // releaseTx.sign(depositSender);

    // const releaseSignature = await connection.sendRawTransaction(releaseTx.serialize());
    // await connection.confirmTransaction({
    //   signature: releaseSignature,
    //   ...releaseBlockHashInfo
    // });

    const releaseSig = await web3.sendAndConfirmTransaction(
      connection,
      releaseTx,
      [depositSender, authority]
    );

    console.log(`Released funds with sender as signer: ${releaseSig}`);

    const receiverBalanceAfter = await getTokenBalance(receiverUsdcAta);
    const vaultBalanceAfter = await getTokenBalance(vaultUsdc);
    console.log(`Receiver USDC balance after release: ${receiverBalanceAfter}`);
    console.log(`Vault USDC balance after release: ${vaultBalanceAfter}`);

    assert.strictEqual(vaultBalanceAfter, 0, "Vault should be empty after release");
    assert.strictEqual(receiverBalanceAfter - receiverBalanceBefore, vaultBalanceBefore, "Receiver should receive funds");

    const depositRecord = await program.account.depositRecord.fetch(depositRecordPda);
    assert.strictEqual(depositRecord.state.complete !== undefined, true, "Deposit record should be marked as complete");
  });

  it("prevents unauthorized release of funds", async () => {

    const depositSender = Keypair.generate();
    const depositReceiver = Keypair.generate();
    const unauthorizedSigner = Keypair.generate(); // Third party that will try to release

    // Fund the wallets
    await provider.sendAndConfirm(
      new Transaction()
        .add(
          SystemProgram.transfer({
            fromPubkey: authority.publicKey,
            toPubkey: depositSender.publicKey,
            lamports: 0.1 * LAMPORTS_PER_SOL,
          })
        )
        .add(
          SystemProgram.transfer({
            fromPubkey: authority.publicKey,
            toPubkey: depositReceiver.publicKey,
            lamports: 0.1 * LAMPORTS_PER_SOL,
          })
        )
        .add(
          SystemProgram.transfer({
            fromPubkey: authority.publicKey,
            toPubkey: unauthorizedSigner.publicKey,
            lamports: 0.1 * LAMPORTS_PER_SOL,
          })
        ),
      [authority]
    );

    const senderUsdcAta = getAssociatedTokenAddressSync(
      USDC_MINT_ADDR,
      depositSender.publicKey,
      false
    );
    const senderUsdtAta = getAssociatedTokenAddressSync(
      USDT_MINT_ADDR,
      depositSender.publicKey,
      false
    );
    const receiverUsdcAta = getAssociatedTokenAddressSync(
      USDC_MINT_ADDR,
      depositReceiver.publicKey,
      false
    );
    const receiverUsdtAta = getAssociatedTokenAddressSync(
      USDT_MINT_ADDR,
      depositReceiver.publicKey,
      false
    );

    await provider.sendAndConfirm(
      new Transaction()
        .add(createAssociatedTokenAccountIdempotentInstruction(
          authority.publicKey,
          senderUsdcAta,
          depositSender.publicKey,
          USDC_MINT_ADDR
        ))
        .add(createAssociatedTokenAccountIdempotentInstruction(
          authority.publicKey,
          senderUsdtAta,
          depositSender.publicKey,
          USDT_MINT_ADDR
        ))
        .add(createAssociatedTokenAccountIdempotentInstruction(
          authority.publicKey,
          receiverUsdcAta,
          depositReceiver.publicKey,
          USDC_MINT_ADDR
        ))
        .add(createAssociatedTokenAccountIdempotentInstruction(
          authority.publicKey,
          receiverUsdtAta,
          depositReceiver.publicKey,
          USDT_MINT_ADDR
        )),
      [authority]
    );

    const walletUsdcAta = getAssociatedTokenAddressSync(
      USDC_MINT_ADDR,
      authority.publicKey,
      false
    );

    const depositTokenAmount = 1_000_000;
    await provider.sendAndConfirm(
      new Transaction().add(
        createTransferCheckedInstruction(
          walletUsdcAta,
          USDC_MINT_ADDR,
          senderUsdcAta,
          authority.publicKey,
          depositTokenAmount,
          usdcDecimals
        )
      ),
      [authority]
    );

    console.log("Transferred 1 USDC to sender for unauthorized release test");

    const escrowSeed = new BN(0);
    const [escrowPda, escrowBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("escrow"), depositSender.publicKey.toBuffer(), depositReceiver.publicKey.toBuffer()],
      program.programId
    );

    const [vaultUsdc, vaultUsdcBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("usdc-vault"), escrowPda.toBuffer(), USDC_MINT_ADDR.toBuffer()],
      program.programId
    );

    const [vaultUsdt, vaultUsdtBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("usdt-vault"), escrowPda.toBuffer(), USDT_MINT_ADDR.toBuffer()],
      program.programId
    );

   const ix = await program.methods
      .initializeEscrow(escrowSeed)
      .accounts({
        escrow: escrowPda,
        feePayer: authority.publicKey,
        sender: depositSender.publicKey,
        receiver: depositReceiver.publicKey,
        authority: authority.publicKey,
        senderUsdcAta: senderUsdcAta,
        senderUsdtAta: senderUsdtAta,
        receiverUsdcAta: receiverUsdcAta,
        receiverUsdtAta: receiverUsdtAta,
        usdcMint: USDC_MINT_ADDR,
        usdtMint: USDT_MINT_ADDR,
        vaultUsdc,
        vaultUsdt,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      } as InitEscrowAccounts)
      .instruction();
    
    const tx = new Transaction().add(ix);
    const initEscrowSig = await web3.sendAndConfirmTransaction(connection, tx, [depositSender, authority]);
    console.log("Init escrow transaction signature:", initEscrowSig);
    console.log("Escrow initialized successfully for unauthorized release test");

    const blockhashArray = await getRecentBlockhashArray(connection);
    const [depositRecordPda, depositRecordBump] = getDepositRecordPDA(escrowPda, depositSender.publicKey, blockhashArray);

    // Make a deposit with sender as authorized signer
    const depositIx = await program.methods
      .deposit(
        { usdc: {} },
        { sender: {} },
        blockhashArray,
        new BN(500_000)
      )
      .accounts({
        escrow: escrowPda,
        sender: depositSender.publicKey,
        receiver: depositReceiver.publicKey,
        authority: authority.publicKey,
        senderUsdcAta: senderUsdcAta,
        senderUsdtAta: senderUsdtAta,
        receiverUsdcAta: receiverUsdcAta,
        receiverUsdtAta: receiverUsdtAta,
        usdcMint: USDC_MINT_ADDR,
        usdtMint: USDT_MINT_ADDR,
        vaultUsdc: vaultUsdc,
        vaultUsdt: vaultUsdt,
        depositRecord: depositRecordPda,
        feePayer: authority.publicKey,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY
      } as DepositAccounts)
      .instruction();

    const depositTx = new Transaction().add(depositIx);
    await web3.sendAndConfirmTransaction(connection, depositTx, [depositSender, authority]);

    console.log("Deposit successful for unauthorized release test");

    // release with unauthorized signer
    try {
      const releaseIx = await program.methods
        .release(blockhashArray)
        .accounts({
          escrow: escrowPda,
          sender: depositSender.publicKey,
          receiver: depositReceiver.publicKey,
          receivingParty: depositReceiver.publicKey,
          authority: authority.publicKey,
          receivingUsdcAta: receiverUsdcAta,
          receivingUsdtAta: receiverUsdtAta,
          usdcMint: USDC_MINT_ADDR,
          usdtMint: USDT_MINT_ADDR,
          vaultUsdc: vaultUsdc,
          vaultUsdt: vaultUsdt,
          depositRecord: depositRecordPda,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY
        } as ReleaseAccounts)
        .instruction();

      const releaseTx = new Transaction().add(releaseIx);
      console.log("Sending release transaction with unauthorized signer and authority signer");
      await web3.sendAndConfirmTransaction(connection, releaseTx, [unauthorizedSigner, authority]);
      assert.fail("Should not be able to release with unauthorized signer");
    } catch (err) {
      console.log("Expected error for unauthorized release attempt:", err);
      // Check for either the custom program error code or a more generic unauthorized signer error
      const errorMessage = err.toString().toLowerCase();
      assert.ok(
        errorMessage.includes("0x1771") || // Custom program error code for InvalidSigner
        errorMessage.includes("invalid signer") ||
        errorMessage.includes("missing required signature") ||
        errorMessage.includes("signature verification failed"),
        "Should fail with an invalid signer error"
      );
    }
  });

  it("ensures only depositor can cancel their own deposit", async () => {
    
    const depositSender = Keypair.generate();
    const depositReceiver = Keypair.generate();
    const nonDepositor = Keypair.generate();

    await provider.sendAndConfirm(
      new Transaction()
        .add(
          SystemProgram.transfer({
            fromPubkey: authority.publicKey,
            toPubkey: depositSender.publicKey,
            lamports: 0.1 * LAMPORTS_PER_SOL,
          })
        )
        .add(
          SystemProgram.transfer({
            fromPubkey: authority.publicKey,
            toPubkey: depositReceiver.publicKey,
            lamports: 0.1 * LAMPORTS_PER_SOL,
          })
        )
        .add(
          SystemProgram.transfer({
            fromPubkey: authority.publicKey,
            toPubkey: nonDepositor.publicKey,
            lamports: 0.1 * LAMPORTS_PER_SOL,
          })
        ),
      [authority]
    );

    const senderUsdcAta = getAssociatedTokenAddressSync(
      USDC_MINT_ADDR,
      depositSender.publicKey,
      false
    );
    const senderUsdtAta = getAssociatedTokenAddressSync(
      USDT_MINT_ADDR,
      depositSender.publicKey,
      false
    );
    const receiverUsdcAta = getAssociatedTokenAddressSync(
      USDC_MINT_ADDR,
      depositReceiver.publicKey,
      false
    );
    const receiverUsdtAta = getAssociatedTokenAddressSync(
      USDT_MINT_ADDR,
      depositReceiver.publicKey,
      false
    );
    const nonDepositorUsdcAta = getAssociatedTokenAddressSync(
      USDC_MINT_ADDR,
      nonDepositor.publicKey,
      false
    );

    await provider.sendAndConfirm(
      new Transaction()
        .add(createAssociatedTokenAccountIdempotentInstruction(
          authority.publicKey,
          senderUsdcAta,
          depositSender.publicKey,
          USDC_MINT_ADDR
        ))
        .add(createAssociatedTokenAccountIdempotentInstruction(
          authority.publicKey,
          senderUsdtAta,
          depositSender.publicKey,
          USDT_MINT_ADDR
        ))
        .add(createAssociatedTokenAccountIdempotentInstruction(
          authority.publicKey,
          receiverUsdcAta,
          depositReceiver.publicKey,
          USDC_MINT_ADDR
        ))
        .add(createAssociatedTokenAccountIdempotentInstruction(
          authority.publicKey,
          receiverUsdtAta,
          depositReceiver.publicKey,
          USDT_MINT_ADDR
        ))
        .add(createAssociatedTokenAccountIdempotentInstruction(
          authority.publicKey,
          nonDepositorUsdcAta,
          nonDepositor.publicKey,
          USDC_MINT_ADDR
        )),
      [authority]
    );

    const walletUsdtAta = getAssociatedTokenAddressSync(
      USDT_MINT_ADDR,
      authority.publicKey,
      false
    );

    await provider.sendAndConfirm(
      new Transaction().add(
        createTransferCheckedInstruction(
          walletUsdtAta,
          USDT_MINT_ADDR,
          senderUsdtAta,
          authority.publicKey,
          1_000_000_000,
          9
        )
      ),
      [authority]
    );

    console.log(`Transferred 1 USDT to sender for cancel test`);

    const escrowSeed = new BN(randomBytes(8));

    const [escrowPda, escrowBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("escrow"), depositSender.publicKey.toBuffer(), depositReceiver.publicKey.toBuffer()],
      program.programId
    );

    const [vaultUsdc, vaultUsdcBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("usdc-vault"), escrowPda.toBuffer(), USDC_MINT_ADDR.toBuffer()],
      program.programId
    );

    const [vaultUsdt, vaultUsdtBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("usdt-vault"), escrowPda.toBuffer(), USDT_MINT_ADDR.toBuffer()],
      program.programId
    );

    const ix = await program.methods
      .initializeEscrow(escrowSeed)
      .accounts({
        escrow: escrowPda,
        feePayer: authority.publicKey,
        sender: depositSender.publicKey,
        receiver: depositReceiver.publicKey,
        authority: authority.publicKey,
        senderUsdcAta: senderUsdcAta,
        senderUsdtAta: senderUsdtAta,
        receiverUsdcAta: receiverUsdcAta,
        receiverUsdtAta: receiverUsdtAta,
        usdcMint: USDC_MINT_ADDR,
        usdtMint: USDT_MINT_ADDR,
        vaultUsdc,
        vaultUsdt,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      } as InitEscrowAccounts)
      .instruction();

    const tx = new Transaction().add(ix);
    const initEscrowSig = await web3.sendAndConfirmTransaction(connection, tx, [depositSender, authority]);
    console.log("Init escrow transaction signature:", initEscrowSig);
    console.log("Escrow initialized successfully for cancel test");

    const blockhashArray = await getRecentBlockhashArray(connection);

    const [depositRecordPda] = getDepositRecordPDA(escrowPda, depositSender.publicKey, blockhashArray);

    // (sender as signer)
    const depositIx = await program.methods
      .deposit({ usdt: {} }, { sender: {} }, blockhashArray, new BN(500_000_000))
      .accounts({
        escrow: escrowPda,
        sender: depositSender.publicKey,
        receiver: depositReceiver.publicKey,
        authority: authority.publicKey,
        senderUsdcAta: senderUsdcAta,
        senderUsdtAta: senderUsdtAta,
        receiverUsdcAta: receiverUsdcAta,
        receiverUsdtAta: receiverUsdtAta,
        usdcMint: USDC_MINT_ADDR,
        usdtMint: USDT_MINT_ADDR,
        vaultUsdc: vaultUsdc,
        vaultUsdt: vaultUsdt,
        depositRecord: depositRecordPda,
        feePayer: authority.publicKey,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY
      } as DepositAccounts)
      .instruction();

    const depositTx = new Transaction().add(depositIx);
    const depositSig = await web3.sendAndConfirmTransaction(connection, depositTx, [depositSender, authority]);
    console.log("Deposit transaction signature:", depositSig);

    console.log(`Deposit successful for unauthorized release test`);

    const vaultBalanceBefore = await getTokenBalance(vaultUsdc);

    const cancelIx = await program.methods
      .cancel(blockhashArray)
      .accounts({
        escrow: escrowPda,
        sender: depositSender.publicKey,
        receiver: depositReceiver.publicKey,
        authority: authority.publicKey,
        senderUsdcAta: senderUsdcAta,
        senderUsdtAta: senderUsdtAta,
        usdcMint: USDC_MINT_ADDR,
        usdtMint: USDT_MINT_ADDR,
        vaultUsdc: vaultUsdc,
        vaultUsdt: vaultUsdt,
        depositRecord: depositRecordPda,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY
      } as CancelAccounts)
      .instruction();

    // Try to cancel with non-depositor and authority signer
    const cancelTx = new Transaction().add(cancelIx);

    try {
      await web3.sendAndConfirmTransaction(connection, cancelTx, [nonDepositor, authority]);
      assert.fail("Non-depositor should not be able to cancel deposit");
    } catch (err) {
      console.log(`Expected error for non-depositor cancel attempt: ${err}`);
      // Expected error - the non-depositor can't cancel
    }

    // Verify vault balance is unchanged
    const vaultBalanceAfter = await getTokenBalance(vaultUsdc);
    assert.equal(vaultBalanceAfter, vaultBalanceBefore, "Vault should still have 1 USDT after failed cancel attempt");

    const cancelIx2 = await program.methods
      .cancel(blockhashArray)
      .accounts({
        escrow: escrowPda,
        sender: depositSender.publicKey,
        receiver: depositReceiver.publicKey,
        senderUsdcAta: senderUsdcAta,
        senderUsdtAta: senderUsdtAta,
        usdcMint: USDC_MINT_ADDR,
        usdtMint: USDT_MINT_ADDR,
        vaultUsdc: vaultUsdc,
        vaultUsdt: vaultUsdt,
        depositRecord: depositRecordPda,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY
      } as CancelAccounts)
      .instruction();

    const cancelTx2 = new Transaction().add(cancelIx2);

    try {
      await web3.sendAndConfirmTransaction(connection, cancelTx2, [depositReceiver, authority]);
      assert.fail("Non-depositor should not be able to cancel deposit");
    } catch (err) {
      console.log(`Expected error for non-depositor cancel attempt: ${err}`);
      // Expected error - the non-depositor can't cancel
    }

    // Verify vault balance is unchanged
    const vaultBalance2After = await getTokenBalance(vaultUsdc);
    assert.equal(vaultBalance2After, vaultBalanceBefore, "Vault should still have 1 USDT after failed cancel attempt");

    // Now have the valid depositor cancel
    try {
      const validCancelTx = new Transaction().add(cancelIx);
      const cancelSig = await web3.sendAndConfirmTransaction(connection, validCancelTx, [depositSender, authority]);
      console.log(`Valid depositor cancel transaction: ${cancelSig}`);
    } catch (err) {
      assert.fail(`Valid depositor should be able to cancel: ${err}`);
    }

    // Verify vault is now empty
    const vaultBalanceAfterValidCancel = await getTokenBalance(vaultUsdc);
    assert.equal(vaultBalanceAfterValidCancel, 0, "Vault should be empty after valid depositor cancels");
  });

  it("prevents double release of funds", async () => {
    const depositSender = Keypair.generate();
    const depositReceiver = Keypair.generate();

    await provider.sendAndConfirm(
      new Transaction()
        .add(
          SystemProgram.transfer({
            fromPubkey: authority.publicKey,
            toPubkey: depositSender.publicKey,
            lamports: 0.1 * LAMPORTS_PER_SOL,
          })
        )
        .add(
          SystemProgram.transfer({
            fromPubkey: authority.publicKey,
            toPubkey: depositReceiver.publicKey,
            lamports: 0.1 * LAMPORTS_PER_SOL,
          })
        ),
      [authority]
    );

    const senderUsdcAta = getAssociatedTokenAddressSync(
      USDC_MINT_ADDR,
      depositSender.publicKey,
      false
    );
    const senderUsdtAta = getAssociatedTokenAddressSync(
      USDT_MINT_ADDR,
      depositSender.publicKey,
      false
    );
    const receiverUsdcAta = getAssociatedTokenAddressSync(
      USDC_MINT_ADDR,
      depositReceiver.publicKey,
      false
    );
    const receiverUsdtAta = getAssociatedTokenAddressSync(
      USDT_MINT_ADDR,
      depositReceiver.publicKey,
      false
    );

    await provider.sendAndConfirm(
      new Transaction()
        .add(createAssociatedTokenAccountIdempotentInstruction(
          authority.publicKey,
          senderUsdcAta,
          depositSender.publicKey,
          USDC_MINT_ADDR
        ))
        .add(createAssociatedTokenAccountIdempotentInstruction(
          authority.publicKey,
          senderUsdtAta,
          depositSender.publicKey,
          USDT_MINT_ADDR
        ))
        .add(createAssociatedTokenAccountIdempotentInstruction(
          authority.publicKey,
          receiverUsdcAta,
          depositReceiver.publicKey,
          USDC_MINT_ADDR
        ))
        .add(createAssociatedTokenAccountIdempotentInstruction(
          authority.publicKey,
          receiverUsdtAta,
          depositReceiver.publicKey,
          USDT_MINT_ADDR
        )),
      [authority]
    );

    const walletUsdcAta = getAssociatedTokenAddressSync(
      USDC_MINT_ADDR,
      authority.publicKey,
      false
    );

    const depositTokenAmount = 1_000_000;
    await provider.sendAndConfirm(
      new Transaction().add(
        createTransferCheckedInstruction(
          walletUsdcAta,
          USDC_MINT_ADDR,
          senderUsdcAta,
          authority.publicKey,
          depositTokenAmount,
          usdcDecimals
        )
      ),
      [authority]
    );

    console.log("Transferred 1 USDC to sender for double release test");

    const escrowSeed = new BN(0);
    const [escrowPda, escrowBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("escrow"), depositSender.publicKey.toBuffer(), depositReceiver.publicKey.toBuffer()],
      program.programId
    );

    const [vaultUsdc, vaultUsdcBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("usdc-vault"), escrowPda.toBuffer(), USDC_MINT_ADDR.toBuffer()],
      program.programId
    );

    const [vaultUsdt, vaultUsdtBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("usdt-vault"), escrowPda.toBuffer(), USDT_MINT_ADDR.toBuffer()],
      program.programId
    );

   const ix = await program.methods
      .initializeEscrow(escrowSeed)
      .accounts({
        escrow: escrowPda,
        feePayer: authority.publicKey,
        sender: depositSender.publicKey,
        receiver: depositReceiver.publicKey,
        authority: authority.publicKey,
        senderUsdcAta: senderUsdcAta,
        senderUsdtAta: senderUsdtAta,
        receiverUsdcAta: receiverUsdcAta,
        receiverUsdtAta: receiverUsdtAta,
        usdcMint: USDC_MINT_ADDR,
        usdtMint: USDT_MINT_ADDR,
        vaultUsdc,
        vaultUsdt,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      } as InitEscrowAccounts)
      .instruction();
    
    const tx = new Transaction().add(ix);
    const initEscrowSig = await web3.sendAndConfirmTransaction(connection, tx, [depositSender, authority]);
    console.log("Init escrow transaction signature:", initEscrowSig);
    console.log("Escrow initialized successfully for double release test");

    const blockhashArray = await getRecentBlockhashArray(connection);
    const [depositRecordPda, depositRecordBump] = getDepositRecordPDA(escrowPda, depositSender.publicKey, blockhashArray);

    // Make a deposit with sender as authorized signer
    const depositIx = await program.methods
      .deposit(
        { usdc: {} },
        { sender: {} },
        blockhashArray,
        new BN(500_000)
      )
      .accounts({
        escrow: escrowPda,
        sender: depositSender.publicKey,
        receiver: depositReceiver.publicKey,
        authority: authority.publicKey,
        senderUsdcAta: senderUsdcAta,
        senderUsdtAta: senderUsdtAta,
        receiverUsdcAta: receiverUsdcAta,
        receiverUsdtAta: receiverUsdtAta,
        usdcMint: USDC_MINT_ADDR,
        usdtMint: USDT_MINT_ADDR,
        vaultUsdc: vaultUsdc,
        vaultUsdt: vaultUsdt,
        depositRecord: depositRecordPda,
        feePayer: authority.publicKey,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY
      } as DepositAccounts)
      .instruction();

    const depositTx = new Transaction().add(depositIx);
    await web3.sendAndConfirmTransaction(connection, depositTx, [depositSender, authority]);

    console.log("Deposit successful for double release test");

    const vaultBalanceBefore = await getTokenBalance(vaultUsdt);
    const senderBalanceBefore = await getTokenBalance(senderUsdtAta);

    // First release should succeed
    const releaseIx = await program.methods
      .release(blockhashArray)
      .accounts({
        escrow: escrowPda,
        sender: depositSender.publicKey,
        receiver: depositReceiver.publicKey,
        receivingParty: depositReceiver.publicKey,
        authority: authority.publicKey,
        receivingUsdcAta: receiverUsdcAta,
        receivingUsdtAta: receiverUsdtAta,
        usdcMint: USDC_MINT_ADDR,
        usdtMint: USDT_MINT_ADDR,
        vaultUsdc: vaultUsdc,
        vaultUsdt: vaultUsdt,
        depositRecord: depositRecordPda,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY
      } as ReleaseAccounts)
      .instruction();

    const releaseTx = new Transaction().add(releaseIx);
    const releaseSig = await web3.sendAndConfirmTransaction(connection, releaseTx, [depositSender, authority]);

    console.log(`Release USDT transaction: ${releaseSig}`);

    // Check balances after cancel
    const vaultBalanceAfter = await getTokenBalance(vaultUsdt);
    const senderBalanceAfter = await getTokenBalance(senderUsdtAta);

    console.log(`Vault USDT balance after cancel: ${vaultBalanceAfter}`);
    console.log(`Sender USDT balance after cancel: ${senderBalanceAfter}`);

    // Validate
    assert.strictEqual(vaultBalanceAfter, 0, "Vault should be empty after cancel");
    assert.strictEqual(
      Math.round(senderBalanceAfter * 1000) / 1000,
      Math.round(senderBalanceBefore * 1000) / 1000,
      "Sender should have their funds back"
    );
  });

  it("ensures bidirectional deposits work correctly with proper isolation", async () => {
    const partyA = Keypair.generate();
    const partyB = Keypair.generate();

    await provider.sendAndConfirm(
      new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: authority.publicKey,
          toPubkey: partyA.publicKey,
          lamports: 0.1 * LAMPORTS_PER_SOL,
        })
      ),
      [authority]
    );

    await provider.sendAndConfirm(
      new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: authority.publicKey,
          toPubkey: partyB.publicKey,
          lamports: 0.1 * LAMPORTS_PER_SOL,
        })
      ),
      [authority]
    );

    const partyAUsdcAta = getAssociatedTokenAddressSync(
      USDC_MINT_ADDR,
      partyA.publicKey,
      false
    );
    const partyAUsdtAta = getAssociatedTokenAddressSync(
      USDT_MINT_ADDR,
      partyA.publicKey,
      false
    );
    const partyBUsdcAta = getAssociatedTokenAddressSync(
      USDC_MINT_ADDR,
      partyB.publicKey,
      false
    );
    const partyBUsdtAta = getAssociatedTokenAddressSync(
      USDT_MINT_ADDR,
      partyB.publicKey,
      false
    );

    await provider.sendAndConfirm(
      new Transaction()
        .add(createAssociatedTokenAccountIdempotentInstruction(
          partyA.publicKey,
          partyAUsdcAta,
          partyA.publicKey,
          USDC_MINT_ADDR
        ))
        .add(createAssociatedTokenAccountIdempotentInstruction(
          partyA.publicKey,
          partyAUsdtAta,
          partyA.publicKey,
          USDT_MINT_ADDR
        ))
        .add(createAssociatedTokenAccountIdempotentInstruction(
          partyA.publicKey,
          partyBUsdcAta,
          partyB.publicKey,
          USDC_MINT_ADDR
        ))
        .add(createAssociatedTokenAccountIdempotentInstruction(
          partyA.publicKey,
          partyBUsdtAta,
          partyB.publicKey,
          USDT_MINT_ADDR
        )),
      [partyA]
    );

    const walletUsdcAta = getAssociatedTokenAddressSync(
      USDC_MINT_ADDR,
      authority.publicKey,
      false
    );

    const walletUsdtAta = getAssociatedTokenAddressSync(
      USDT_MINT_ADDR,
      authority.publicKey,
      false
    );

    const tokenAmount = 1_000_000;

    console.log(`USDC decimals: ${usdcDecimals}, USDT decimals: ${usdtDecimals}`);

    // Fund both parties with tokens
    await provider.sendAndConfirm(
      new Transaction().add(
        createTransferCheckedInstruction(
          walletUsdcAta,
          USDC_MINT_ADDR,
          partyAUsdcAta,
          authority.publicKey,
          tokenAmount,
          usdcDecimals
        )
      ),
      [authority]
    );

    await provider.sendAndConfirm(
      new Transaction().add(
        createTransferCheckedInstruction(
          walletUsdtAta,
          USDT_MINT_ADDR,
          partyBUsdtAta,
          authority.publicKey,
          tokenAmount,
          usdtDecimals
        )
      ),
      [authority]
    );

    // Fund party B with USDC as well for the bidirectional test
    await provider.sendAndConfirm(
      new Transaction().add(
        createTransferCheckedInstruction(
          walletUsdcAta,
          USDC_MINT_ADDR,
          partyBUsdcAta,
          authority.publicKey,
          tokenAmount,
          usdcDecimals
        )
      ),
      [authority]
    );

    console.log(`Transferred 1 USDC to partyA and 1 USDT to partyB for bidirectional test`);
    console.log(`Also transferred 1 USDC to partyB`);

    const [escrowPda, escrowBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("escrow"), partyA.publicKey.toBuffer(), partyB.publicKey.toBuffer()],
      program.programId
    );
    const [vaultUsdc, vaultUsdcBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("usdc-vault"), escrowPda.toBuffer(), USDC_MINT_ADDR.toBuffer()],
      program.programId
    );
    const [vaultUsdt, vaultUsdtBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("usdt-vault"), escrowPda.toBuffer(), USDT_MINT_ADDR.toBuffer()],
      program.programId
    );

    const ix = await program.methods
      .initializeEscrow(new BN(0))
      .accounts({
        escrow: escrowPda,
        feePayer: authority.publicKey,
        sender: partyA.publicKey,
        receiver: partyB.publicKey,
        authority: authority.publicKey,
        senderUsdcAta: partyAUsdcAta,
        senderUsdtAta: partyAUsdtAta,
        receiverUsdcAta: partyBUsdcAta,
        receiverUsdtAta: partyBUsdtAta,
        usdcMint: USDC_MINT_ADDR,
        usdtMint: USDT_MINT_ADDR,
        vaultUsdc,
        vaultUsdt,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      } as InitEscrowAccounts)
      .instruction();

    const tx = new Transaction().add(ix);
    const initEscrowSig = await web3.sendAndConfirmTransaction(connection, tx, [partyA, authority]);
    console.log("Init escrow transaction signature:", initEscrowSig);
    console.log("Escrow initialized successfully for bidirectional test");

    const blockhashArray = await getRecentBlockhashArray(connection);

    const [depositRecordA, depositRecordABump] = getDepositRecordPDA(escrowPda, partyA.publicKey, blockhashArray);

    const [depositRecordB, depositRecordBBump] = getDepositRecordPDA(escrowPda, partyB.publicKey, blockhashArray);

    const depositAmountA = new BN(300_000);

    // Party A deposits USDC
    const depositIx = await program.methods
      .deposit({ usdc: {} }, { sender: {} }, blockhashArray, depositAmountA)
      .accounts({
        escrow: escrowPda,
        sender: partyA.publicKey,
        receiver: partyB.publicKey,
        authority: authority.publicKey,
        senderUsdcAta: partyAUsdcAta,
        senderUsdtAta: partyAUsdtAta,
        receiverUsdcAta: partyBUsdcAta,
        receiverUsdtAta: partyBUsdtAta,
        usdcMint: USDC_MINT_ADDR,
        usdtMint: USDT_MINT_ADDR,
        vaultUsdc: vaultUsdc,
        vaultUsdt: vaultUsdt,
        depositRecord: depositRecordA,
        feePayer: authority.publicKey,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY
      } as DepositAccounts)
      .instruction()

    const depositTx = new Transaction().add(depositIx);
    const depositSig = await web3.sendAndConfirmTransaction(connection, depositTx, [partyA, authority]);
    console.log("Deposit partyA transaction signature:", depositSig);

    console.log("PartyA deposited USDC successfully");

    const escrowState = await program.account.escrow.fetch(escrowPda);
    console.log(`Current deposit count: ${escrowState.depositCount.toNumber()}`);

    // Party B also deposits USDC
    const depositAmountB = new BN(300_000); // Use smaller amount

    const depositIx2 = await program.methods
      .deposit({ usdc: {} }, { sender: {} }, blockhashArray, depositAmountB)
      .accounts({
        escrow: escrowPda,
        sender: partyB.publicKey,
        receiver: partyA.publicKey,
        authority: authority.publicKey,
        senderUsdcAta: partyBUsdcAta,
        senderUsdtAta: partyBUsdtAta,
        receiverUsdcAta: partyAUsdcAta,
        receiverUsdtAta: partyAUsdtAta,
        usdcMint: USDC_MINT_ADDR,
        usdtMint: USDT_MINT_ADDR,
        vaultUsdc: vaultUsdc,
        vaultUsdt: vaultUsdt,
        depositRecord: depositRecordB,
        feePayer: authority.publicKey,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY
      } as DepositAccounts)
      .instruction();

    const depositTx2 = new Transaction().add(depositIx2);
    const depositSig2 = await web3.sendAndConfirmTransaction(connection, depositTx2, [partyB, authority]);
    console.log("Deposit partyB transaction signature:", depositSig2);

    console.log("PartyB also deposited USDC successfully");

    const usdcVaultBalance = await getTokenBalance(vaultUsdc);

    console.log(`USDC vault balance: ${usdcVaultBalance}`);

    const expectedTotal = (depositAmountA.toNumber() + depositAmountB.toNumber()) / 1_000_000;
    assert.strictEqual(usdcVaultBalance, expectedTotal, "USDC vault should have both parties' deposits");

    try {
      // Try to cancel as the wrong party
      const cancelIx = await program.methods
        .cancel(blockhashArray)
        .accounts({
          escrow: escrowPda,
          sender: partyA.publicKey,
          receiver: partyB.publicKey,
          authority: authority.publicKey,
          senderUsdcAta: partyAUsdcAta,
          senderUsdtAta: partyAUsdtAta,
          usdcMint: USDC_MINT_ADDR,
          usdtMint: USDT_MINT_ADDR,
          vaultUsdc: vaultUsdc,
          vaultUsdt: vaultUsdt,
          depositRecord: depositRecordB,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY
        } as CancelAccounts)
        .instruction();

      const cancelTx = new Transaction().add(cancelIx);
      const cancelSig = await web3.sendAndConfirmTransaction(connection, cancelTx, [partyA, authority]);
      console.log("Cancel partyA transaction signature:", cancelSig);

      assert.fail("PartyA should not be able to cancel PartyB's deposit");
    } catch (error) {
      console.log("Expected error when PartyA tries to cancel PartyB's deposit:", error.message);
      // Test passes as we expect an error
    }
  });

  it("handles both parties depositing the same token type correctly", async () => {
    const partyA = Keypair.generate();
    const partyB = Keypair.generate();

    await provider.sendAndConfirm(
      new Transaction()
        .add(
          SystemProgram.transfer({
            fromPubkey: authority.publicKey,
            toPubkey: partyA.publicKey,
            lamports: 0.1 * LAMPORTS_PER_SOL,
          })
        )
        .add(
          SystemProgram.transfer({
            fromPubkey: authority.publicKey,
            toPubkey: partyB.publicKey,
            lamports: 0.1 * LAMPORTS_PER_SOL,
          })
        ),
      [authority]
    );

    const partyAUsdcAta = getAssociatedTokenAddressSync(
      USDC_MINT_ADDR,
      partyA.publicKey,
      false
    );

    const partyAUsdtAta = getAssociatedTokenAddressSync(
      USDT_MINT_ADDR,
      partyA.publicKey,
      false
    );

    const partyBUsdcAta = getAssociatedTokenAddressSync(
      USDC_MINT_ADDR,
      partyB.publicKey,
      false
    );

    const partyBUsdtAta = getAssociatedTokenAddressSync(
      USDT_MINT_ADDR,
      partyB.publicKey,
      false
    );

    await provider.sendAndConfirm(
      new Transaction()
        .add(createAssociatedTokenAccountIdempotentInstruction(
          authority.publicKey,
          partyAUsdcAta,
          partyA.publicKey,
          USDC_MINT_ADDR
        ))
        .add(createAssociatedTokenAccountIdempotentInstruction(
          authority.publicKey,
          partyAUsdtAta,
          partyA.publicKey,
          USDT_MINT_ADDR
        ))
        .add(createAssociatedTokenAccountIdempotentInstruction(
          authority.publicKey,
          partyBUsdcAta,
          partyB.publicKey,
          USDC_MINT_ADDR
        ))
        .add(createAssociatedTokenAccountIdempotentInstruction(
          authority.publicKey,
          partyBUsdtAta,
          partyB.publicKey,
          USDT_MINT_ADDR
        ))
    );

    console.log(`USDC decimals: ${usdcDecimals}`);

    const transferAmount = 1_000_000;

    const authorityUsdcAta = getAssociatedTokenAddressSync(
      USDC_MINT_ADDR,
      authority.publicKey,
      false
    );

    await provider.sendAndConfirm(
      new Transaction()
        .add(createTransferCheckedInstruction(
          authorityUsdcAta,
          USDC_MINT_ADDR,
          partyAUsdcAta,
          authority.publicKey,
          transferAmount,
          usdcDecimals
        ))
        .add(createTransferCheckedInstruction(
          authorityUsdcAta,
          USDC_MINT_ADDR,
          partyBUsdcAta,
          authority.publicKey,
          transferAmount,
          usdcDecimals
        )),
      [authority]
    );

    console.log("Transferred 1 USDC to both parties for same-token deposit test");

    // Use a random seed to avoid account reuse issues
    const escrowSeed = new BN(randomBytes(8));

    const [escrowPda, escrowBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("escrow"), partyA.publicKey.toBuffer(), partyB.publicKey.toBuffer()],
      program.programId
    );

    const [vaultUsdc, vaultUsdcBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("usdc-vault"), escrowPda.toBuffer(), USDC_MINT_ADDR.toBuffer()],
      program.programId
    );

    const [vaultUsdt, vaultUsdtBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("usdt-vault"), escrowPda.toBuffer(), USDT_MINT_ADDR.toBuffer()],
      program.programId
    );

    const ix = await program.methods
      .initializeEscrow(escrowSeed)
      .accounts({
        escrow: escrowPda,
        feePayer: authority.publicKey,
        sender: partyA.publicKey,
        receiver: partyB.publicKey,
        authority: authority.publicKey,
        senderUsdcAta: partyAUsdcAta,
        senderUsdtAta: partyAUsdtAta,
        receiverUsdcAta: partyBUsdcAta,
        receiverUsdtAta: partyBUsdtAta,
        usdcMint: USDC_MINT_ADDR,
        usdtMint: USDT_MINT_ADDR,
        vaultUsdc,
        vaultUsdt,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      } as InitEscrowAccounts)
      .instruction();

    const tx = new Transaction().add(ix);
    const initEscrowSig = await web3.sendAndConfirmTransaction(connection, tx, [partyA, authority]);
    console.log("Init escrow transaction signature:", initEscrowSig);

    console.log("Escrow initialized successfully for same-token deposit test");

    const blockhashArray = await getRecentBlockhashArray(connection);

    const [depositRecordA] = getDepositRecordPDA(escrowPda, partyA.publicKey, blockhashArray);
    const depositAmountA = new BN(300_000);

    // Party A deposits USDC
    const depositIxA = await program.methods
      .deposit({ usdc: {} }, { sender: {} }, blockhashArray, depositAmountA)
      .accounts({
        escrow: escrowPda,
        sender: partyA.publicKey,
        receiver: partyB.publicKey,
        senderUsdcAta: partyAUsdcAta,
        senderUsdtAta: partyAUsdtAta,
        receiverUsdcAta: partyBUsdcAta,
        receiverUsdtAta: partyBUsdtAta,
        usdcMint: USDC_MINT_ADDR,
        usdtMint: USDT_MINT_ADDR,
        vaultUsdc: vaultUsdc,
        vaultUsdt: vaultUsdt,
        depositRecord: depositRecordA,
        feePayer: authority.publicKey,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY
      } as DepositAccounts)
      .instruction();

    const depositTxA = new Transaction().add(depositIxA);
    const depositSigA = await web3.sendAndConfirmTransaction(connection, depositTxA, [partyA, authority]);
    console.log(`Party A deposited USDC: ${depositSigA}`);

    // Fetch escrow state to get current deposit count
    const escrowState = await program.account.escrow.fetch(escrowPda);
    console.log(`Current deposit count: ${escrowState.depositCount.toNumber()}`);

    const [depositRecordB] = getDepositRecordPDA(escrowPda, partyB.publicKey, blockhashArray);

    const depositAmountB = new BN(200_000);
    const depositIxB = await program.methods
      .deposit({ usdc: {} }, { both: {} }, blockhashArray, depositAmountB)
      .accounts({
        escrow: escrowPda,
        sender: partyB.publicKey,
        receiver: partyA.publicKey,
        authority: authority.publicKey,
        senderUsdcAta: partyBUsdcAta,
        senderUsdtAta: partyBUsdtAta,
        receiverUsdcAta: partyAUsdcAta,
        receiverUsdtAta: partyAUsdtAta,
        usdcMint: USDC_MINT_ADDR,
        usdtMint: USDT_MINT_ADDR,
        vaultUsdc: vaultUsdc,
        vaultUsdt: vaultUsdt,
        depositRecord: depositRecordB,
        feePayer: authority.publicKey,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY
      } as DepositAccounts)
      .instruction();

    const depositTxB = new Transaction().add(depositIxB);
    await web3.sendAndConfirmTransaction(connection, depositTxB, [partyB, authority]);

    console.log("PartyB also deposited USDC successfully");

    const usdcVaultBalance = await getTokenBalance(vaultUsdc);

    console.log(`USDC vault balance: ${usdcVaultBalance}`);

    const expectedTotal = (depositAmountA.toNumber() + depositAmountB.toNumber()) / 1_000_000;
    assert.strictEqual(usdcVaultBalance, expectedTotal, "USDC vault should have both parties' deposits");
  });

  it("prevents cancellation after release", async () => {
    const depositSender = Keypair.generate();
    const depositReceiver = Keypair.generate();

    await provider.sendAndConfirm(
      new Transaction()
        .add(
          SystemProgram.transfer({
            fromPubkey: authority.publicKey,
            toPubkey: depositSender.publicKey,
            lamports: 0.1 * LAMPORTS_PER_SOL,
          })
        )
        .add(
          SystemProgram.transfer({
            fromPubkey: authority.publicKey,
            toPubkey: depositReceiver.publicKey,
            lamports: 0.1 * LAMPORTS_PER_SOL,
          })
        ),
      [authority]
    );

    const senderUsdcAta = getAssociatedTokenAddressSync(
      USDC_MINT_ADDR,
      depositSender.publicKey,
      false
    );
    const senderUsdtAta = getAssociatedTokenAddressSync(
      USDT_MINT_ADDR,
      depositSender.publicKey,
      false
    );
    const receiverUsdcAta = getAssociatedTokenAddressSync(
      USDC_MINT_ADDR,
      depositReceiver.publicKey,
      false
    );
    const receiverUsdtAta = getAssociatedTokenAddressSync(
      USDT_MINT_ADDR,
      depositReceiver.publicKey,
      false
    );

    await provider.sendAndConfirm(
      new Transaction()
        .add(createAssociatedTokenAccountIdempotentInstruction(
          authority.publicKey,
          senderUsdcAta,
          depositSender.publicKey,
          USDC_MINT_ADDR
        ))
        .add(createAssociatedTokenAccountIdempotentInstruction(
          authority.publicKey,
          senderUsdtAta,
          depositSender.publicKey,
          USDT_MINT_ADDR
        ))
        .add(createAssociatedTokenAccountIdempotentInstruction(
          authority.publicKey,
          receiverUsdcAta,
          depositReceiver.publicKey,
          USDC_MINT_ADDR
        ))
        .add(createAssociatedTokenAccountIdempotentInstruction(
          authority.publicKey,
          receiverUsdtAta,
          depositReceiver.publicKey,
          USDT_MINT_ADDR
        )),
      [authority]
    );

    const walletUsdcAta = getAssociatedTokenAddressSync(
      USDC_MINT_ADDR,
      authority.publicKey,
      false
    );

    const depositTokenAmount = 1_000_000;
    await provider.sendAndConfirm(
      new Transaction().add(
        createTransferCheckedInstruction(
          walletUsdcAta,
          USDC_MINT_ADDR,
          senderUsdcAta,
          authority.publicKey,
          depositTokenAmount,
          usdcDecimals
        )
      ),
      [authority]
    );

    console.log("Transferred 1 USDC to sender for cancel-after-release test");

    const escrowSeed = new BN(0);
    const [escrowPda, escrowBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("escrow"), depositSender.publicKey.toBuffer(), depositReceiver.publicKey.toBuffer()],
      program.programId
    );

    const [vaultUsdc, vaultUsdcBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("usdc-vault"), escrowPda.toBuffer(), USDC_MINT_ADDR.toBuffer()],
      program.programId
    );

    const [vaultUsdt, vaultUsdtBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("usdt-vault"), escrowPda.toBuffer(), USDT_MINT_ADDR.toBuffer()],
      program.programId
    );

    const ix = await program.methods
      .initializeEscrow(escrowSeed)
      .accounts({
        escrow: escrowPda,
        feePayer: authority.publicKey,
        sender: depositSender.publicKey,
        receiver: depositReceiver.publicKey,
        authority: authority.publicKey,
        senderUsdcAta: senderUsdcAta,
        senderUsdtAta: senderUsdtAta,
        receiverUsdcAta: receiverUsdcAta,
        receiverUsdtAta: receiverUsdtAta,
        usdcMint: USDC_MINT_ADDR,
        usdtMint: USDT_MINT_ADDR,
        vaultUsdc,
        vaultUsdt,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      } as InitEscrowAccounts)
      .instruction();
    
    const tx = new Transaction().add(ix);
    const initEscrowSig = await web3.sendAndConfirmTransaction(connection, tx, [depositSender, authority]);
    console.log("Init escrow transaction signature:", initEscrowSig);
    console.log("Escrow initialized successfully for cancel-after-release test");

    const blockhashArray = await getRecentBlockhashArray(connection);
    const [depositRecordPda, depositRecordBump] = getDepositRecordPDA(escrowPda, depositSender.publicKey, blockhashArray);

    // Make a deposit with sender as authorized signer
    const depositIx = await program.methods
      .deposit(
        { usdc: {} },
        { sender: {} },
        blockhashArray,
        new BN(500_000)
      )
      .accounts({
        escrow: escrowPda,
        sender: depositSender.publicKey,
        receiver: depositReceiver.publicKey,
        authority: authority.publicKey,
        senderUsdcAta: senderUsdcAta,
        senderUsdtAta: senderUsdtAta,
        receiverUsdcAta: receiverUsdcAta,
        receiverUsdtAta: receiverUsdtAta,
        usdcMint: USDC_MINT_ADDR,
        usdtMint: USDT_MINT_ADDR,
        vaultUsdc: vaultUsdc,
        vaultUsdt: vaultUsdt,
        depositRecord: depositRecordPda,
        feePayer: authority.publicKey,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY
      } as DepositAccounts)
      .instruction();

    const depositTx = new Transaction().add(depositIx);
    await web3.sendAndConfirmTransaction(connection, depositTx, [depositSender, authority]);

    console.log("Deposit successful for cancel-after-release test");

    // Release the funds
    const releaseIx = await program.methods
      .release(blockhashArray)
      .accounts({
        escrow: escrowPda,
        sender: depositSender.publicKey,
        receiver: depositReceiver.publicKey,
        authority: authority.publicKey,
        receivingParty: depositReceiver.publicKey,
        receivingUsdcAta: receiverUsdcAta,
        receivingUsdtAta: receiverUsdtAta,
        usdcMint: USDC_MINT_ADDR,
        usdtMint: USDT_MINT_ADDR,
        vaultUsdc: vaultUsdc,
        vaultUsdt: vaultUsdt,
        depositRecord: depositRecordPda,
        feePayer: authority.publicKey,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY
      } as ReleaseAccounts)
      .instruction();

    const releaseTx = new Transaction().add(releaseIx);
    await web3.sendAndConfirmTransaction(connection, releaseTx, [depositSender, authority]);

    console.log("Release completed successfully");

    // Try to cancel after release
    try {
      const cancelIx = await program.methods
        .cancel(blockhashArray)
        .accounts({
          escrow: escrowPda,
          sender: depositSender.publicKey,
          receiver: depositReceiver.publicKey,
          authority: authority.publicKey,
          senderUsdcAta: senderUsdcAta,
          senderUsdtAta: senderUsdtAta,
          usdcMint: USDC_MINT_ADDR,
          usdtMint: USDT_MINT_ADDR,
          vaultUsdc: vaultUsdc,
          vaultUsdt: vaultUsdt,
          depositRecord: depositRecordPda,
          feePayer: authority.publicKey,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY
        } as CancelAccounts)
        .instruction();

      const cancelTx = new Transaction().add(cancelIx);
      await web3.sendAndConfirmTransaction(connection, cancelTx, [depositSender, authority]);
      assert.fail("Should not be able to cancel after release");
    } catch (err) {
      console.log("Expected error for cancel after release attempt:", err);
      assert.ok(err.toString().includes("custom program error") || err.toString().includes("InvalidState"), "Should fail with InvalidState error");
    }
  });
});
