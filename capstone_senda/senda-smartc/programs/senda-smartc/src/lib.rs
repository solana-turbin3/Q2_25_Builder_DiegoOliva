#![allow(unexpected_cfgs)]
use anchor_lang::prelude::*;

mod instructions;
use instructions::*;
mod error;
mod state;

declare_id!("B3DT8RTGLr4k34jidDKKDYaLZcsveSmMVD7CWfvq8bgn");

#[program]
pub mod senda_smartc {
    use super::*;

    pub fn init_factory(ctx: Context<InitializeFactory>) -> Result<()> {
        ctx.accounts.init_factory(&ctx.bumps)
    }

    pub fn initialize_escrow(ctx: Context<InitializeEscrow>, seed: u64) -> Result<()> {
        ctx.accounts.init_escrow(seed, &ctx.bumps)
    }

    pub fn deposit(
        ctx: Context<Deposit>,
        stable: state::Stable,
        authorization: state::AuthorizedBy,
        _recent_blockhash: [u8; 32],
        amount: u64,
    ) -> Result<()> {
        ctx.accounts.deposit(stable, authorization, &ctx.bumps, amount)
    }

    pub fn cancel(ctx: Context<Cancel>, recent_blockhash: [u8; 32]) -> Result<()> {
        ctx.accounts.cancel(recent_blockhash)
    }

    pub fn release(ctx: Context<Release>, recent_blockhash: [u8; 32]) -> Result<()> {
        ctx.accounts.release(recent_blockhash)
    }
}