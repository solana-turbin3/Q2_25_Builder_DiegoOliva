import { Connection, Keypair, PublicKey, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js"
import { Program, Wallet, AnchorProvider, Idl } from "@coral-xyz/anchor"
import { IDL, Turbin3Prereq } from "./programs/Turbin3_prereq";
import wallet from "./Turbin3-wallet.json"

const connection = new Connection("https://api.devnet.solana.com", "confirmed");
const keypair = Keypair.fromSecretKey(new Uint8Array(wallet));

// (async () => {
//     const balance = await connection.getBalance(keypair.publicKey);
//     console.log(`Wallet balance: ${balance / LAMPORTS_PER_SOL} SOL`);
// })();

const github = Buffer.from("dedeleono", "utf8");

const provider = new AnchorProvider(connection, new Wallet(keypair), {
    commitment: "confirmed",
});

const program: Program<Turbin3Prereq> = new Program(IDL, provider);

const enrollment_seeds = [Buffer.from("preQ225"), keypair.publicKey.toBuffer()];
// const enrollment_seeds = [Buffer.from("pre"), keypair.publicKey.toBuffer()];
const [enrollment_key, _bump] = PublicKey.findProgramAddressSync(enrollment_seeds, program.programId);


(async () => {
    try {
        const fetchedIdl = await Program.fetchIdl(program.programId, provider);
        console.log("Fetched IDL:", JSON.stringify(fetchedIdl, null, 2));
    } catch (e) {
        console.error("Failed to fetch IDL:", e);
    }
})();


console.log("Program methods:", Object.keys(program.methods));
console.log("Program account names:", Object.keys(program.account));

// Execute our enrollment transaction
(async () => {
    try {
        console.log("Starting enrollment with wallet:", keypair.publicKey.toString());
        console.log("Program ID:", program.programId.toString());
        console.log("Enrollment key:", enrollment_key.toString());
        
        const txhash = await program.methods
            .submit(github)
            .accounts({
                signer: keypair.publicKey,
                prereq: enrollment_key,
                system_program: SystemProgram.programId
            })
            .signers([keypair])
            .rpc();
        
        console.log(`Success! Check out your TX here:
https://explorer.solana.com/tx/${txhash}?cluster=devnet`);
    } catch (e) {
        console.error(`Oops, something went wrong:`, e);
        if ('error' in (e as any) && 'logs' in (e as any).error) {
            console.error('Program Logs:', (e as any).error.logs);
        }
    }
})();