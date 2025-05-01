use anchor_lang::prelude::*;
use anchor_spl::{
    metadata::
    {mpl_token_metadata::instructions::
        {
            FreezeDelegatedAccountCpi,
            FreezeDelegatedAccountCpiAccounts
        }, 
        MasterEditionAccount,
        Metadata,MetadataAccount
    },
    token::
    {
        approve,
        Approve,
        Mint,
        Token,
        TokenAccount
    },};

use crate::state::user_account::UserAccount;
use crate::state::{StakeAccount, StakeConfig};

#[derive(Accounts)]
pub struct Stake<'info> {


    #[account(mut)]
    pub user: Signer<'info>,
    pub mint: Account<'info, Mint>,
    pub collection_mint: Account<'info, Mint>,

    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = user,
    )]
    pub mint_ata: Account<'info, TokenAccount>,

    #[account(
        seeds = [
            b"metadata",
            metadata_program.key().as_ref(),
            mint.key().as_ref(),
        ],
        seeds::program = metadata_program.key(),
        bump,
        constraint = metadata.collection.as_ref().unwrap().key == collection_mint.key(),
        constraint = metadata.collection.as_ref().unwrap().verified
        
    )]
    pub metadata: Account <'info, MetadataAccount>,

    #[account(
        seeds = [
            b"metadata",
            metadata_program.key().as_ref(),
            mint.key().as_ref(),
            b"edition",
        ],
        seeds::program = metadata_program.key(),
        bump,
    )]
    pub master_edition: Account<'info, MasterEditionAccount>,

    #[account(
        init,
        payer = user,
        seeds = [b"stake",user.key().as_ref(), mint.key().as_ref()],
        bump,
        space = 8 + StakeAccount::INIT_SPACE,
    )]
    pub stake_account: Account<'info, StakeAccount>,

    #[account(
        seeds = [b"config"],
        bump = config.bumps,
    )]
    pub config: Account<'info, StakeConfig>,

    #[account(
        mut,
        seeds = [b"user_account", user.key().as_ref(), mint.key().as_ref()],
        bump = user_account.bump,
    )]
    pub user_account: Account<'info, UserAccount>,

    pub metadata_program: Program<'info, Metadata>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
}

impl<'info> Stake<'info> {
    pub fn stake(&mut self, bumps: &StakeBumps) -> Result<()> {
        
        assert!(self.user_account.amount_staked <= self.config.max_stake);

        let cpi_program = self.token_program.to_account_info();

        let cpi_accounts = Approve {
            to: self.mint_ata.to_account_info(),
            delegate: self.stake_account.to_account_info(),
            authority: self.user.to_account_info(),
        };

        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);

        approve(cpi_ctx, 1)?;

        let delegate = &self.stake_account.to_account_info();
        let token_account = &self.mint_ata.to_account_info();
        let edition = &self.master_edition.to_account_info();
        let mint = &self.mint.to_account_info();
        let token_program = &self.token_program.to_account_info();
        let metadata = &self.metadata.to_account_info();

        let config_key = self.config.to_account_info().key();
        let mint_key = self.mint.to_account_info().key();
        
        let seeds = &[
            b"stake",
            config_key.as_ref(),
            mint_key.as_ref(),
            &[self.stake_account.bump]
        ];

        let signer_seeds = &[&seeds[..]];

        let cpi_accounts_freeze = FreezeDelegatedAccountCpiAccounts {
            delegate,
            token_account,
            edition,
            mint,
            token_program,
        };

        FreezeDelegatedAccountCpi::new(&cpi_program, cpi_accounts_freeze).invoke_signed(signer_seeds);

        self.stake_account.set_inner(StakeAccount {
            owner: self.user.key(),
            mint: self.mint.key(),
            staked_at: Clock::get()?.unix_timestamp,
            bump: bumps.stake_account,
        });

        self.user_account.amount_staked += 1;

        Ok(())
    }
}

// @todo: unstake, claim rewards