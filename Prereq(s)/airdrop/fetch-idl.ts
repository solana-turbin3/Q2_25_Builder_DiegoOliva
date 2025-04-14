import { Connection, PublicKey } from "@solana/web3.js";
import { Program, AnchorProvider, Wallet } from "@coral-xyz/anchor";
import { Keypair } from "@solana/web3.js";

// Initialize connection to devnet
const connection = new Connection("https://api.devnet.solana.com", "confirmed");

// Create a dummy wallet since we're just reading data
const dummyWallet = new Wallet(Keypair.generate());

// Create provider
const provider = new AnchorProvider(connection, dummyWallet, {
    commitment: "confirmed",
});

// The program ID you want to fetch
const programId = new PublicKey("ADcaide4vBtKuyZQqdU689YqEGZMCmS4tL35bdTv9wJa");

(async () => {
    try {
        const fetchedIdl = await Program.fetchIdl(programId, provider);
        console.log("Fetched IDL:", JSON.stringify(fetchedIdl, null, 2));
    } catch (e) {
        console.error("Failed to fetch IDL:", e);
        if (e instanceof Error) {
            console.error("Error message:", e.message);
        }
    }
})(); 