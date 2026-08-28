import { NextResponse } from 'next/server';
import { badRequest, handle, readJson, requireUser } from '@/lib/http';
import { AccountError, updateAccount } from '@/lib/accounts';
import { normalizeUsername } from '@/lib/identity';
import { logActivity } from '@/lib/activity';

interface PatchBody {
  active?: boolean;
  resetPassword?: boolean;
}

export async function PATCH(req: Request, ctx: { params: Promise<{ username: string }> }) {
  return handle(async () => {
    const admin = await requireUser('admin');
    const target = normalizeUsername(decodeURIComponent((await ctx.params).username));
    const { active, resetPassword } = await readJson<PatchBody>(req);

    if (active === false && target === normalizeUsername(admin.username)) {
      badRequest("You can't deactivate your own account.");
    }

    try {
      const result = await updateAccount(target, { active, resetPassword });

      // One call can do both, so both are recorded. Never the password itself:
      // `result.password` is a live credential, and the whole reason it comes
      // back at all is that it is shown once and then gone.
      if (active !== undefined) {
        logActivity({
          actor: admin,
          action: active ? 'account.reactivated' : 'account.deactivated',
          entityType: 'account',
          entityId: target,
          entityLabel: target,
          details: { role: result.account.role },
        });
      }
      if (resetPassword) {
        logActivity({
          actor: admin,
          action: 'account.password_reset',
          entityType: 'account',
          entityId: target,
          entityLabel: target,
          details: { role: result.account.role },
        });
      }

      return NextResponse.json({ account: result.account, password: result.password });
    } catch (e) {
      if (e instanceof AccountError) badRequest(e.message);
      throw e;
    }
  });
}
