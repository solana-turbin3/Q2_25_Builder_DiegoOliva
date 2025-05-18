use anchor_lang::prelude::*;

use anchor_spl::{
    associated_token::AssociatedToken,
    token::{transfer_checked, TransferChecked, Token, Mint as SplMint, TokenAccount as SplTokenAccount},
};

use crate::error::ErrorCode;
use crate::state::{Escrow, DepositState, DepositRecord, Stable};

#[derive(Accounts)]
#[instruction(recent_blockhash: [u8; 32])]
pub struct Cancel<'info> {
    #[account(mut, seeds = [b"escrow", escrow.sender.as_ref(), escrow.receiver.as_ref()], bump = escrow.bump)]
    pub escrow: Box<Account<'info, Escrow>>,

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

    #[account(
        mut,
        associated_token::mint = usdc_mint,
        associated_token::authority = sender,
    )]
    pub sender_usdc_ata: Box<Account<'info, SplTokenAccount>>,

    #[account(
        mut,
        associated_token::mint = usdt_mint,
        associated_token::authority = sender,
    )]
    pub sender_usdt_ata: Box<Account<'info, SplTokenAccount>>,

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
        bump = deposit_record.bump,
    )]
    pub deposit_record: Account<'info, DepositRecord>,

    pub associated_token_program: Program<'info, AssociatedToken>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

impl<'info> Cancel<'info> {
    pub fn cancel(&mut self, _recent_blockhash: [u8; 32]) -> Result<()> {

        require!(
            self.deposit_record.state == DepositState::PendingWithdrawal,
            ErrorCode::InvalidState
        );

        // Only the original depositor (sender) can cancel
        require!(
            self.sender.is_signer,
            ErrorCode::InvalidSigner
        );
        
        let (amount, mint, vault, decimals) = if self.deposit_record.stable == Stable::Usdc {
            (
                self.deposit_record.amount,
                self.usdc_mint.to_account_info(),
                self.vault_usdc.to_account_info(),
                self.usdc_mint.decimals,
            )
        } else {
            (
                self.deposit_record.amount,
                self.usdt_mint.to_account_info(),
                self.vault_usdt.to_account_info(), 
                self.usdt_mint.decimals,
            )
        };

        let cpi_accounts = TransferChecked {
            from: vault,
            mint,
            to: if self.deposit_record.stable == Stable::Usdc {
                self.sender_usdc_ata.to_account_info()
            } else {
                self.sender_usdt_ata.to_account_info()
            },
            authority: self.escrow.to_account_info(),
        };

        let escrow_seeds: [&[u8]; 4] = [
            b"escrow".as_ref(),
            self.escrow.sender.as_ref(),
            self.escrow.receiver.as_ref(),
            &[self.escrow.bump],
        ];
        let seeds_slice: &[&[u8]] = &escrow_seeds;
        
        let signer_seeds = &[seeds_slice];
        let cpi_ctx = CpiContext::new_with_signer(
            self.token_program.to_account_info(),
            cpi_accounts,
            signer_seeds,
        );
        transfer_checked(cpi_ctx, amount, decimals)?;

        match self.deposit_record.stable {
            Stable::Usdc => {
                self.escrow.deposited_usdc = self.escrow.deposited_usdc.checked_sub(amount).unwrap_or(0);
            },
            Stable::Usdt => {
                self.escrow.deposited_usdt = self.escrow.deposited_usdt.checked_sub(amount).unwrap_or(0);
            },
        }

        self.deposit_record.state = DepositState::Cancelled;
        
        Ok(())
    }
}
