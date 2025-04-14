use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer, Transfer};
use solana_program::system_program::{ID as SYSTEM_PROGRAM_ID};

// The program ID is a unique identifier for this program on the Solana blockchain
// It's derived from the deployer's public key and the name of the program binary
declare_id!("Vc1nLACYjBXHnuWMJEQH9M1DnHeCaR2iZCv1NvnZQ9K");

// The #[program] macro identifies the module containing instruction handlers
// Think of these as the "API endpoints" of your Solana program
#[program]
pub mod vault {
    use super::*;

    // Initialize instruction - called once to set up the vault
    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        ctx.accounts.initialize(&ctx.bumps)?;
        Ok(())
    }

    // Deposit instruction - allows users to deposit SOL into the vault
    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()>{
        ctx.accounts.deposit(amount)?;
        Ok(())
    }

    // Withdraw instruction - allows users to withdraw SOL from the vault
    pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
        ctx.accounts.withdraw(amount)?;
        Ok(())
    }
}

// The #[derive(Accounts)] macro generates account validation code
// This struct defines which accounts are needed for the initialize instruction
#[derive(Accounts)]
pub struct Initialize<'info> {
    // The user who will pay for account creation and own the vault
    #[account(mut)]  // mut = this account's lamports will be changed (fees)
    pub signer: Signer<'info>,  // Signer = this account must sign the transaction
    
    // The vault PDA (Program Derived Address) that will hold user funds
    #[account(
        seeds = [b"vault", signer.key().as_ref()],  // Deterministic address derivation
        bump  // Anchor automatically finds the bump to make this a valid PDA
    )]
    pub vault: SystemAccount<'info>,  // SystemAccount = an account that can hold SOL
    
    // The account that will store the vault's metadata/state
    #[account(
        init,  // Create a new account
        payer = signer,  // signer pays for account creation
        seeds = [b"state", signer.key().as_ref()],  // PDA derivation
        bump,  // Automatically find valid bump
        space = 8 + VaultState::INIT_SPACE, // 8 bytes for account discriminator + size of VaultState | this one of the common wasy for account sizing and bumping
    )]
    pub vault_state: Account<'info, VaultState>,  // This account will hold VaultState data
    
    // The system program is required for account creation and transfers
    pub system_program: Program<'info, System>,
}

// Implementation block contains the actual logic for the initialize instruction
impl <'info>Initialize<'info> {
    // Store the bump seeds so we can use them later for verification and signing
    pub fn initialize(&mut self, bumps: &InitializeBumps) -> Result<()> {
        self.vault_state.vault_bump = bumps.vault;
        self.vault_state.state_bump = bumps.vault_state;
        Ok(())
    }
}

// Account validation for the deposit instruction
#[derive(Accounts)]
pub struct Deposit<'info> {
    // The user depositing funds
    #[account(mut)]  // Will be modified (lamports deducted)
    pub signer: Signer<'info>,  // Must sign the transaction
    
    // The vault receiving the funds
    #[account(
        mut,  // Will be modified (lamports added)
        seeds = [b"vault", signer.key().as_ref()],  // Same seeds as in Initialize
        bump = vault_state.vault_bump  // Use stored bump from state
    )]
    pub vault: SystemAccount<'info>,
    
    // The account storing vault metadata
    #[account(
        mut,  // Might be modified in the future (not in this basic example)
        seeds = [b"state", signer.key().as_ref()],  // Same seeds as in Initialize
        bump = vault_state.state_bump,  // Use stored bump from state
    )]
    pub vault_state: Account<'info, VaultState>,
    
    // Required for transfer
    pub system_program: Program<'info, System>,
}

impl <'info>Deposit<'info> {
    pub fn deposit(&mut self, amount: u64) -> Result<()> {
        // Create a CPI (Cross-Program Invocation) to the system program
        // A CPI allows our program to call another program on Solana
        let cpi_program = self.system_program.to_account_info();

        // Create a Transfer struct that specifies the accounts involved in the transfer
        // In deposit, the user is sending funds TO the vault
        // Note: Unlike withdraw, we don't need the PDA to sign because
        // the user (transaction signer) is authorizing sending their own funds
        let cpi_accounts = Transfer {
            from: self.signer.to_account_info(),  // User is sending funds
            to: self.vault.to_account_info(),     // Vault is receiving funds
        };

        // Create a CPI Context which combines the program and accounts
        // We use regular CpiContext::new() because we don't need PDA signing
        // The original transaction signer is already authorizing this transfer
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);

        // Execute the transfer by calling the system program
        // This moves SOL from the user's wallet to the vault PDA
        transfer(cpi_ctx, amount)?;
        Ok(())
    }
}

// Account validation for the withdraw instruction
#[derive(Accounts)]
pub struct Withdraw<'info> {
    // The user withdrawing funds
    #[account(mut)]  // Will be modified (lamports added)
    pub signer: Signer<'info>,  // Must sign the transaction
    
    // The vault PDA that holds the funds
    #[account(
        mut,  // Will be modified (lamports deducted)
        seeds = [b"vault", signer.key().as_ref()],  // Same seeds as in Initialize
        bump = vault_state.vault_bump  // Use stored bump from state
    )]
    pub vault: SystemAccount<'info>,
    
    // The account storing vault metadata
    #[account(
        mut,  // Might be modified in the future
        seeds = [b"state", signer.key().as_ref()],  // Same seeds as in Initialize
        bump = vault_state.state_bump,  // Use stored bump from state
    )]
    pub vault_state: Account<'info, VaultState>,
    
    // Required for transfer
    pub system_program: Program<'info, System>,
}

impl <'info>Withdraw<'info> {
    pub fn withdraw(&mut self, amount: u64) -> Result<()> {
        // Get the bump seed for the vault PDA
        let vault_bump = self.vault_state.vault_bump;
        
        // Create the seeds for the PDA signature
        // These seeds must match exactly what was used to create the PDA
        let vault_seeds = &[
            b"vault",                     // The seed prefix as bytes
            self.signer.key().as_ref(),   // The signer's public key as bytes
            &[vault_bump],                // The bump value as a single-element array
        ];
        
        // Create the nested reference structure required for PDA signing
        // EXPLANATION:
        // 1. vault_seeds[..] is a slice referring to the entire vault_seeds array
        // 2. &vault_seeds[..] creates a reference to this slice
        // 3. [&vault_seeds[..]] creates a new array containing just one element: the reference to our seeds
        // 4. &[&vault_seeds[..]] creates a reference to this array of seed references
        //
        // This complex structure is required by Solana's signing system because:
        // - The outer reference &[...] allows for multiple PDAs to sign (though we only use one)
        // - Each inner reference &[...] represents all the seeds for one PDA
        // - This format allows the runtime to reconstruct and verify PDA addresses
        let signer_seeds = &[&vault_seeds[..]];
        
        // Create a CPI to the system program
        // The system program is responsible for transferring SOL
        let cpi_program = self.system_program.to_account_info();
        
        // Create the Transfer struct for the withdrawal
        // This specifies the accounts involved in the transfer
        let cpi_accounts = Transfer {
            from: self.vault.to_account_info(),  // The PDA vault is sending funds
            to: self.signer.to_account_info(),   // The user is receiving funds
        };
        
        // Create CPI context with signer seeds to authorize the PDA to sign
        // This is different from deposit because:
        // - In deposit, the user signs to send funds TO the vault
        // - In withdraw, the vault PDA must "sign" to send funds FROM itself
        // - Since PDAs don't have private keys, we use seeds+bump to authorize
        let cpi_ctx = CpiContext::new_with_signer(
            cpi_program,
            cpi_accounts,
            signer_seeds,  // This provides the authorization for the PDA to sign
        );
        
        // Execute the transfer
        // This calls the system program with all the accounts and authorization
        transfer(cpi_ctx, amount)?;
        Ok(())
    }
}

// The #[account] macro marks this as an account data structure
// This will be stored in the vault_state account
#[account]
pub struct VaultState {
    pub vault_bump: u8,  // Stores the bump for the vault PDA
    pub state_bump: u8,  // Stores the bump for the state PDA
} // We need bumps to find PDAs

// The Space trait implementation tells Anchor how much space to allocate
impl Space for VaultState {
    const INIT_SPACE: usize = 1 + 1;  // 1 byte for each u8
}