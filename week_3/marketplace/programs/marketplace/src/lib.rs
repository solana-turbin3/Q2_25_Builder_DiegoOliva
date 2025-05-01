#![allow(unexpected_cfgs)]
use anchor_lang::prelude::*;
mod instructions;
mod state;

use crate::instructions::*;

declare_id!("5pQQj6vitSPqHJZ7JYr9ZNfCvvgNe9ZiZPQxnKjeBDsN");

#[program]
pub mod marketplace {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, name: String, fee: u16) -> Result<()> {
        ctx.accounts.init(name, fee, &ctx.bumps)
    }

    pub fn listing(ctx: Context<List>, price: u64) -> Result<()> {
        ctx.accounts.create_listing(price, &ctx.bumps)?;
        ctx.accounts.deposit_nft()
    }

    pub fn purchase(ctx: Context<Purchase>) -> Result<()> {
        Ok(())
    }
    
}