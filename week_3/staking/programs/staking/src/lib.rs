use anchor_lang::prelude::*;

mod instructions;
mod state;

declare_id!("79ZQoEipDJpujBzit8VtTqLktPKAuTC3aqJChfzLsxCo");

#[program]
pub mod staking {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        msg!("Greetings from: {:?}", ctx.program_id);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize {}
