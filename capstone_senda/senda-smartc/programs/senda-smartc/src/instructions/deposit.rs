use anchor_lang::prelude::*;
use std::str::FromStr;

use anchor_spl::{
    associated_token::AssociatedToken,
    token::{transfer_checked, TransferChecked, Token, Mint as SplMint, TokenAccount as SplTokenAccount},
};

use crate::error::ErrorCode;
use crate::state::{Escrow, DepositRecord, DepositState, Stable, USDC_MINT_ADDR, USDT_MINT_ADDR, EscrowState, AuthorizedBy};

#[derive(Accounts)]
#[instruction(stable: Stable, authorization: AuthorizedBy, recent_blockhash: [u8; 32])]
pub struct Deposit<'info> {
    #[account(mut, seeds = [b"escrow", escrow.sender.as_ref(), escrow.receiver.as_ref()], bump = escrow.bump)]
    pub escrow: Box<Account<'info, Escrow>>,

    #[account(mut)]
    pub sender: Signer<'info>,

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

    #[account(
        associated_token::mint = usdc_mint,
        associated_token::authority = receiver,
    )]
    pub receiver_usdc_ata: Box<Account<'info, SplTokenAccount>>,

    #[account(
        associated_token::mint = usdt_mint,
        associated_token::authority = receiver,
    )]
    pub receiver_usdt_ata: Box<Account<'info, SplTokenAccount>>,

    #[account(
        mint::token_program = token_program,
        constraint = (
            usdc_mint.key() == Pubkey::from_str(USDC_MINT_ADDR).unwrap() || 
            usdc_mint.key() == Pubkey::from_str("Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr").unwrap()
        ) @ ErrorCode::InvalidUsdcMint
    )]
    pub usdc_mint: Box<Account<'info, SplMint>>,

    #[account(
        mint::token_program = token_program,
        constraint = (
            usdt_mint.key() == Pubkey::from_str(USDT_MINT_ADDR).unwrap() ||
            usdt_mint.key() == Pubkey::from_str("J2B12TxqtZkXtMAPY1BX2noiTSDNrz4VqiKfU5Sh9t5d").unwrap()
        ) @ ErrorCode::InvalidUsdtMint
    )]
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

    /// CHECK: This account is only used to pay for account creation fees and rent
    #[account(mut, signer)]
    pub fee_payer: AccountInfo<'info>,

    #[account(
        init,
        payer = fee_payer,
        space = 8 + DepositRecord::INIT_SPACE,
        seeds = [
            b"deposit",
            escrow.key().as_ref(),
            sender.key().as_ref(),
            recent_blockhash.as_ref()
        ],
        bump
    )]
    pub deposit_record: Box<Account<'info, DepositRecord>>,

    pub associated_token_program: Program<'info, AssociatedToken>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

impl<'info> Deposit<'info> {
    pub fn deposit(
        &mut self,
        stable: Stable,
        authorization: AuthorizedBy,
        bump: &DepositBumps,
        amount: u64,
    ) -> Result<()> {
        
        require!(
           self.escrow.state == EscrowState::Active,
           ErrorCode::InvalidState
        );

        let escrow = &mut self.escrow;
        let deposit_idx = escrow.deposit_count;

        // signature policy based on authorization
        let policy = authorization.to_policy(escrow.sender, escrow.receiver);

        self.deposit_record.set_inner(DepositRecord {
            escrow: escrow.key(),
            deposit_idx,
            amount,
            policy,
            bump: bump.deposit_record,
            stable: stable.clone(),
            state: DepositState::PendingWithdrawal,
        });

        let (from_account, mint_info, to_info, decimals) = match stable {
            Stable::Usdc => (
                self.sender_usdc_ata.to_account_info(),
                self.usdc_mint.to_account_info(),
                self.vault_usdc.to_account_info(),
                self.usdc_mint.decimals,
            ),
            Stable::Usdt => (
                self.sender_usdt_ata.to_account_info(),
                self.usdt_mint.to_account_info(),
                self.vault_usdt.to_account_info(),
                self.usdt_mint.decimals,
            ),
        };

        let cpi_accounts = TransferChecked {
            from: from_account,
            mint: mint_info,
            to: to_info,
            authority: self.sender.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(self.token_program.to_account_info(), cpi_accounts);
        transfer_checked(cpi_ctx, amount, decimals)?;

        match stable {
            Stable::Usdc => self.escrow.deposited_usdc += amount,
            Stable::Usdt => self.escrow.deposited_usdt += amount,
        }
        self.escrow.deposit_count += 1;

        Ok(())
    }
}
