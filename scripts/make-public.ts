import { getConfig } from './getConfig';
import initBucket from './initBucket';

export default async function up(cwd: string, userBucket: string | null = null){
  const config = await getConfig(cwd);
  const hosting = await initBucket(config, (process.env.HOIST_EMULATE ? config.bucket : (userBucket || config.bucket)).toLowerCase())
  await hosting.makePublic();
  return;
}
