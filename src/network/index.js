import { login } from './session.js';
import { joinRoom } from './client.js';
import {
  config,
  configPath,
  hasCcwCredentials,
  writeDefaultConfigIfMissing,
} from '../config.js';

// 缺少对局服务器凭据（data/config.json 被 gitignore，控制平面托管的实例
// 必须通过环境变量 CCW_* 注入，见 controlplane/.env.example 的 MS_* 变量）
if (!hasCcwCredentials()) {
  if (writeDefaultConfigIfMissing()) {
    console.log(
      `Default config created at ${configPath}. Please fill it out and run the program again.`,
    );
    process.exit(0);
  }
  console.error(
    '[Config] 缺少对局服务器登录凭据：请填写 data/config.json，' +
      '或通过环境变量设置 CCW_UUID / CCW_PASSWORD / CCW_PROJECT_ID / CCW_ROOM_ID。',
  );
  process.exit(1);
}

const auth = {
  uuid: config.uuid,
  name: config.name,
  extra: config.extra,
  cookie: await login(config.uuid, config.password),
};

const room = await joinRoom(
  config.server,
  config.roomType,
  config.projectId,
  config.roomId,
  auth,
);

console.log(`Joined room ${config.roomId} successfully!`);
console.log(
  `[Backend] ${config.backendUrl} (token ${config.backendToken ? 'set' : 'NOT set — 结算上报不可用'})`,
);
export default room;
