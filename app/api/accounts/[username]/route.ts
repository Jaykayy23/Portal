import { NextResponse } from 'next/server';
import { badRequest, handle, readJson, requireUser } from '@/lib/http';
import { AccountError, updateAccount } from '@/lib/accounts';
import { normalizeUsername } from '@/lib/identity';

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
      return NextResponse.json({ account: result.account, password: result.password });
    } catch (e) {
      if (e instanceof AccountError) badRequest(e.message);
      throw e;
    }
  });
}
