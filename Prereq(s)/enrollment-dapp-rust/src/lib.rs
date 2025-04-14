pub mod programs;

use solana_client::rpc_client::RpcClient;
use solana_program::pubkey::Pubkey;
use std::str::FromStr;
use anchor_client::Cluster;

const RPC_URL: &str = "https://api.devnet.solana.com";
const PROGRAM_ID: &str = "ADcaide4vBtKuyZQqdU689YqEGZMCmS4tL35bdTv9wJa";

#[cfg(test)]
mod tests {
    use solana_sdk::{
        signature::{Keypair, Signer, read_keypair_file},
        transaction::Transaction,
        hash::hash,
        message::Message
    };
    use solana_client::rpc_client::RpcClient;
    use solana_program::{
        pubkey::Pubkey,
        system_instruction::transfer,
    };
    use std::{io::{self, BufRead}, str::FromStr};
    use bs58;
    use crate::programs::turbin3_prereq::{TurbinePrereqProgram, CompleteArgs};

    const RPC_URL: &str = "https://api.devnet.solana.com";

    #[test]
    fn submit_github_username() {
        let signer = read_keypair_file("Turbin3-wallet.json").expect("Couldn't find wallet file");
        
        let rpc_client = RpcClient::new(RPC_URL);

        // Derive the PDA for the prereq account with the correct seed
        let prereq = TurbinePrereqProgram::derive_program_address(&[
            b"prereq",
            signer.pubkey().to_bytes().as_ref()
        ]);

        // Check if the account exists
        if let Ok(account) = rpc_client.get_account(&prereq) {
            println!("Account already exists. Current data: {:?}", account.data);
            println!("Please use a different wallet or wait for the program to be updated to support updates.");
            return;
        }

        // Define our instruction data
        let args = CompleteArgs {
            github: b"dedeleono".to_vec()
        };

        // Get recent blockhash
        let blockhash = rpc_client
            .get_latest_blockhash()
            .expect("Failed to get recent blockhash");

        // Create and sign the transaction
        let transaction = TurbinePrereqProgram::complete(
            &[
                &signer.pubkey(),
                &prereq,
                &solana_program::system_program::id()
            ],
            &args,
            Some(&signer.pubkey()),
            &[&signer],
            blockhash
        );

        // Send the transaction
        let signature = rpc_client
            .send_and_confirm_transaction(&transaction)
            .expect("Failed to send transaction");

        // Print our transaction out
        println!(
            "Success! Check out your TX here: https://explorer.solana.com/tx/{}/?cluster=devnet",
            signature
        );
    }

    #[test]
    fn keygen() {
        // Create a new keypair
        let kp = Keypair::new();
        println!("You've generated a new Solana wallet: {}", kp.pubkey().to_string());
        println!("");
        println!("To save your wallet, copy and paste the following into a JSON file:");
        println!("{:?}", kp.to_bytes());
    }

    #[test]
    fn airdrop() {
        // Import our keypair
        let keypair = read_keypair_file("dev-wallet.json").expect("Couldn't find wallet file");
        
        // Connected to Solana Devnet RPC Client
        let client = RpcClient::new(RPC_URL);
        
        // We're going to claim 2 devnet SOL tokens (2 billion lamports)
        match client.request_airdrop(&keypair.pubkey(), 2_000_000_000u64) {
            Ok(s) => {
                println!("Success! Check out your TX here:");
                println!("https://explorer.solana.com/tx/{}?cluster=devnet", s.to_string());
            },
            Err(e) => println!("Oops, something went wrong: {}", e.to_string())
        };
    }

    #[test]
    fn transfer_sol() {
        // Import our keypair
        let keypair = read_keypair_file("dev-wallet.json").expect("Couldn't find wallet file");
        
        // With the imported Keypair, we can sign a new message.
        let pubkey = keypair.pubkey();
        let message_bytes = b"I verify my solana Keypair!";
        let sig = keypair.sign_message(message_bytes);
        let sig_hashed = hash(sig.as_ref());
        
        // After that we can verify the signature, using the default implementation
        match sig.verify(&pubkey.to_bytes(), &sig_hashed.to_bytes()) {
            true => println!("Signature verified"),
            false => println!("Verification failed"),
        }

        // Define our Turbin3 public key
        let to_pubkey = Pubkey::from_str("HshrTnktrUG5BziMyJw5hB2rPBPZ7oYtaB3ZsoU4kX9v").unwrap();
        let rpc_client = RpcClient::new(RPC_URL);
        let recent_blockhash = rpc_client
            .get_latest_blockhash()
            .expect("Failed to get recent blockhash");

        // Create and sign the transaction
        let transaction = Transaction::new_signed_with_payer(
            &[transfer(
                &keypair.pubkey(),
                &to_pubkey,
                1_000_000
            )],
            Some(&keypair.pubkey()),
            &vec![&keypair],
            recent_blockhash
        );

        // Send the transaction
        let signature = rpc_client
            .send_and_confirm_transaction(&transaction)
            .expect("Failed to send transaction");

        // Print our transaction out
        println!(
            "Success! Check out your TX here: https://explorer.solana.com/tx/{}/?cluster=devnet",
            signature
        );
    }

    #[test]
    fn base58_to_wallet() {
        println!("Input your private key as base58:");
        let stdin = io::stdin();
        let base58 = stdin.lock().lines().next().unwrap().unwrap();
        println!("Your wallet file is:");
        let wallet = bs58::decode(base58).into_vec().unwrap();
        println!("{:?}", wallet);
    }

    #[test]
    fn wallet_to_base58() {
        println!("Input your private key as a wallet file byte array:");
        let stdin = io::stdin();
        let wallet = stdin
            .lock()
            .lines()
            .next()
            .unwrap()
            .unwrap()
            .trim_start_matches('[')
            .trim_end_matches(']')
            .split(',')
            .map(|s| s.trim().parse::<u8>().unwrap())
            .collect::<Vec<u8>>();

        println!("Your private key is:");
        let base58 = bs58::encode(wallet).into_string();
        println!("{:?}", base58);
    }

    #[test]
    fn empty_wallet() {
        // Import our keypair
        let keypair = read_keypair_file("dev-wallet.json").expect("Couldn't find wallet file");
        
        let to_pubkey = Pubkey::from_str("HshrTnktrUG5BziMyJw5hB2rPBPZ7oYtaB3ZsoU4kX9v").unwrap();
        let rpc_client = RpcClient::new(RPC_URL);
        let recent_blockhash = rpc_client
            .get_latest_blockhash()
            .expect("Failed to get recent blockhash");

        
        let balance = rpc_client
            .get_balance(&keypair.pubkey())
            .expect("Failed to get balance");

        println!("Current balance: {} lamports", balance);

        let message = Message::new_with_blockhash(
            &[transfer(
                &keypair.pubkey(),
                &to_pubkey,
                balance,
            )],
            Some(&keypair.pubkey()),
            &recent_blockhash
        );

        let fee = rpc_client
            .get_fee_for_message(&message)
            .expect("Failed to get fee calculator");

        println!("Transaction fee: {} lamports", fee);

        let transaction = Transaction::new_signed_with_payer(
            &[transfer(
                &keypair.pubkey(),
                &to_pubkey,
                balance - fee,
            )],
            Some(&keypair.pubkey()),
            &vec![&keypair],
            recent_blockhash
        );

        let signature = rpc_client
            .send_and_confirm_transaction(&transaction)
            .expect("Failed to send transaction");

        println!(
            "Success! Check out your TX here: https://explorer.solana.com/tx/{}/?cluster=devnet",
            signature
        );
    }
}