import { SystemProgram,Transaction, Commitment, Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, sendAndConfirmTransaction } from "@solana/web3.js"
import wallet from "../Turbin3-wallet.json";
import { getOrCreateAssociatedTokenAccount, transfer } from "@solana/spl-token";

// We're going to import our keypair from the wallet file
const keypair = Keypair.fromSecretKey(new Uint8Array(wallet));

//Create a Solana devnet connection
const commitment: Commitment = "confirmed";
const connection = new Connection("https://api.devnet.solana.com", commitment);

// Mint address
const mint = new PublicKey("79jvhqZ65AioPS7Qm3FFQCPDyEMaRJA9g5sM4bBpnuQh");

// Recipient address
const to = new PublicKey("4d8GRErtZXynBwgaX5Xfdr7ERdQuwoxGgG9sseziQuRc");

(async () => {
    try {
        // Get the token account of the fromWallet address, and if it does not exist, create it
        const fromAta = await getOrCreateAssociatedTokenAccount(connection, keypair, mint, keypair.publicKey)

        const toAta = await getOrCreateAssociatedTokenAccount(connection, keypair, mint, keypair.publicKey)

        const tx = await transfer(connection, keypair, fromAta.address, toAta.address, keypair, 1)
        // Get the token account of the toWallet address, and if it does not exist, create it
        console.log(`Your transfer txid: ${tx}`);
        // Transfer the new token to the "toTokenAccount" we just created
    } catch(e) {
        console.error(`Oops, something went wrong: ${e}`)
    }
})();