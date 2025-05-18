use anchor_lang::prelude::*;

use anchor_spl::{
    associated_token::AssociatedToken,
    token::{transfer_checked, TransferChecked, Token, Mint as SplMint, TokenAccount as SplTokenAccount},
};

use crate::error::ErrorCode;
use crate::state::{Escrow, DepositState, DepositRecord, Stable, SignaturePolicy};

#[derive(Accounts)]
#[instruction(recent_blockhash: [u8; 32])]
pub struct Release<'info> {
    #[account(
        mut,
        seeds = [b"escrow", escrow.sender.as_ref(), escrow.receiver.as_ref()],
        bump = escrow.bump
    )]
    pub escrow: Account<'info, Escrow>,

    /// CHECK: Sender of the escrow
    #[account(mut)]
    pub sender: AccountInfo<'info>,
    
    /// CHECK: Receiver of the escrow
    #[account(mut)]
    pub receiver: AccountInfo<'info>,

    #[account(
        mut,
        signer,
        constraint = authority.key() == escrow.authority @ ErrorCode::InvalidAuthority
    )]
    pub authority: Signer<'info>,

    /// CHECK: Account that will receive the funds
    #[account(mut)]
    pub receiving_party: AccountInfo<'info>,

    #[account(
        mut,
        associated_token::mint = usdc_mint,
        associated_token::authority = receiving_party,
    )]
    pub receiving_usdc_ata: Box<Account<'info, SplTokenAccount>>,

    #[account(
        mut,
        associated_token::mint = usdt_mint,
        associated_token::authority = receiving_party,
    )]
    pub receiving_usdt_ata: Box<Account<'info, SplTokenAccount>>,

    #[account(mint::token_program = token_program)]
    pub usdc_mint: Box<Account<'info, SplMint>>,

    #[account(mint::token_program = token_program)]
    pub usdt_mint: Box<Account<'info, SplMint>>,

    #[account(
        mut,
        token::mint = usdc_mint,
        token::authority = escrow,
        seeds = [b"usdc-vault", escrow.key().as_ref(), usdc_mint.key().as_ref()],
        bump,
    )]
    pub vault_usdc: Box<Account<'info, SplTokenAccount>>,

    #[account(
        mut,
        token::mint = usdt_mint,
        token::authority = escrow,
        seeds = [b"usdt-vault", escrow.key().as_ref(), usdt_mint.key().as_ref()],
        bump,
    )]
    pub vault_usdt: Box<Account<'info, SplTokenAccount>>,

    #[account(
        mut,
        constraint = deposit_record.escrow == escrow.key() @ ErrorCode::InvalidState,
        constraint = deposit_record.state == DepositState::PendingWithdrawal @ ErrorCode::InvalidState,
        seeds = [
            b"deposit",
            escrow.key().as_ref(),
            sender.key().as_ref(),
            recent_blockhash.as_ref()
        ],
        bump,
    )]
    pub deposit_record: Account<'info, DepositRecord>,

    pub associated_token_program: Program<'info, AssociatedToken>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

impl<'info> Release<'info> {
    pub fn release(&mut self, _recent_blockhash: [u8; 32]) -> Result<()> {

        require!(
            self.deposit_record.state == DepositState::PendingWithdrawal,
            ErrorCode::InvalidState
        );

        match self.deposit_record.policy {
            SignaturePolicy::Dual => {
                require!(
                    self.sender.is_signer && self.receiver.is_signer,
                    ErrorCode::InvalidSigner
                );
            }
            SignaturePolicy::Single { signer } => {
                require!(
                    (signer == self.sender.key() && self.sender.is_signer) ||
                    (signer == self.receiver.key() && self.receiver.is_signer),
                    ErrorCode::InvalidSigner
                );
            }
        }
        
        let amount = self.deposit_record.amount;
        let stable = self.deposit_record.stable.clone();
        
        let (vault, to_ata, mint, decimals) = match stable {
            Stable::Usdc => (
                &self.vault_usdc,
                &self.receiving_usdc_ata,
                &self.usdc_mint,
                self.usdc_mint.decimals,
            ),
            Stable::Usdt => (
                &self.vault_usdt,
                &self.receiving_usdt_ata,
                &self.usdt_mint,
                self.usdt_mint.decimals,
            ),
        };

        let cpi_accounts = TransferChecked {
            from: vault.to_account_info(),
            mint: mint.to_account_info(),
            to: to_ata.to_account_info(),
            authority: self.escrow.to_account_info(),
        };

        let bump = self.escrow.bump;
        let escrow_seeds: [&[u8]; 4] = [
            b"escrow".as_ref(),
            self.escrow.sender.as_ref(),
            self.escrow.receiver.as_ref(),
            &[bump],
        ];
        let seeds_slice: &[&[u8]] = &escrow_seeds;
        let signer_seeds = &[seeds_slice];
        
        let cpi_ctx = CpiContext::new_with_signer(
            self.token_program.to_account_info(),
            cpi_accounts,
            signer_seeds,
        );

        transfer_checked(cpi_ctx, amount, decimals)?;

        match stable {
            Stable::Usdc => self.escrow.deposited_usdc = self.escrow.deposited_usdc.checked_sub(amount).unwrap(),
            Stable::Usdt => self.escrow.deposited_usdt = self.escrow.deposited_usdt.checked_sub(amount).unwrap(),
        }

        self.deposit_record.state = DepositState::Complete;

        Ok(())
    }
}
