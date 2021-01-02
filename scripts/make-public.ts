import { getConfig } from './getConfig';
import initBucket from './initBucket';

export default async function up(cwd: string, userBucket=null){
  const config = await getConfig(cwd);
  const hosting = await initBucket(config, (userBucket || config.bucket).toLowerCase())
  await hosting.makePublic();
  return;
}