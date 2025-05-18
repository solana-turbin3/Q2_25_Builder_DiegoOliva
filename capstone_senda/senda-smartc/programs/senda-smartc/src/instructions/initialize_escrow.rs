use anchor_lang::prelude::*;
use std::str::FromStr;

use anchor_spl::{
    associated_token::AssociatedToken,
    token::{Token, Mint as SplMint, TokenAccount as SplTokenAccount},
};

use crate::error::ErrorCode;
use crate::state::{Escrow, EscrowState, Factory, USDC_MINT_ADDR, USDT_MINT_ADDR};

#[derive(Accounts)]
pub struct InitializeEscrow<'info> {
    /// CHECK: fee payer
    #[account(mut, signer)]
    pub fee_payer: AccountInfo<'info>,

    #[account(
        seeds = [b"factory", authority.key().as_ref()],
        bump,
        constraint = factory.admin == authority.key() @ ErrorCode::InvalidAuthority
    )]
    pub factory: Account<'info, Factory>,

    #[account(
        init,
        payer = fee_payer,
        seeds = [b"escrow", sender.key().as_ref(), receiver.key().as_ref()],
        space = 8 + Escrow::INIT_SPACE,
        bump,
    )]
    pub escrow: Account<'info, Escrow>,

    #[account(mut)]
    pub sender: Signer<'info>,
    /// CHECK: we're just storing the pubkey
    pub receiver: AccountInfo<'info>,

    #[account(
        mut, 
        signer,
        constraint = authority.key() != sender.key() @ ErrorCode::InvalidAuthority
    )]
    pub authority: Signer<'info>,

    #[account(
        associated_token::mint = usdc_mint,
        associated_token::authority = sender,
        associated_token::token_program = token_program
    )]
    pub sender_usdc_ata: Box<Account<'info, SplTokenAccount>>,

    #[account(
        associated_token::mint = usdt_mint,
        associated_token::authority = sender,
        associated_token::token_program = token_program
    )]
    pub sender_usdt_ata: Box<Account<'info, SplTokenAccount>>,

    #[account(
        associated_token::mint = usdc_mint,
        associated_token::authority = receiver,
        associated_token::token_program = token_program
    )]
    pub receiver_usdc_ata: Box<Account<'info, SplTokenAccount>>,

    #[account(
        associated_token::mint = usdt_mint,
        associated_token::authority = receiver,
        associated_token::token_program = token_program
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
    init,
    payer = fee_payer,
    token::mint = usdc_mint,
    token::authority = escrow,
    seeds = [b"usdc-vault", escrow.key().as_ref(), usdc_mint.key().as_ref()],
    bump,
    )]
    pub vault_usdc: Box<Account<'info, SplTokenAccount>>,

    #[account(
    init,
    payer = fee_payer,
    token::mint = usdt_mint,
    token::authority = escrow,
    seeds = [b"usdt-vault", escrow.key().as_ref(), usdt_mint.key().as_ref()],
    bump,
    )]
    pub vault_usdt: Box<Account<'info, SplTokenAccount>>,

    pub associated_token_program: Program<'info, AssociatedToken>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}


impl<'info> InitializeEscrow<'info> {
    pub fn init_escrow(&mut self, seed: u64, bump: &InitializeEscrowBumps) -> Result<()> {
        self.escrow.set_inner(Escrow{
            seed,
            sender: self.sender.key(),
            receiver: self.receiver.key(),
            authority: self.authority.key(),
            usdc_mint: self.usdc_mint.key(),
            usdt_mint: self.usdt_mint.key(),
            vault_usdc: self.vault_usdc.key(),
            vault_usdt: self.vault_usdt.key(),
            bump: bump.escrow,
            vault_usdc_bump: bump.vault_usdc,
            vault_usdt_bump: bump.vault_usdt,
            deposited_usdc: 0,
            deposited_usdt: 0,
            deposit_count: 0,
            state: EscrowState::Active,
        });

        Ok(())
    }
}
// @todo allow users to link multiple wallets to the protocol, while keeping a single escrow per sender/receiver pair - users must set a primary wallet
