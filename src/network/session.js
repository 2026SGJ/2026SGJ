import logger from '../../logger/index.js';

const login = async (uuid, pass) => {
    logger.debug(`[session] login 开始: uuid=${uuid}`);
    const response = await fetch('https://sso.ccw.site/web/auth/login-by-password', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36'
        },
        body: JSON.stringify({"loginKey":uuid,"clientCode":"STUDY_COMMUNITY","password":pass,"extra":"{\"device\":\"Windows 10\",\"browser\":\"Chrome 146\",\"scene\":null}"})
    });
    if (!response.ok) {
        logger.error(`[session] 登录失败: ${response.statusText}`);
        throw new Error(`Login failed: ${response.statusText}`);
    }
    logger.debug(`[session] SSO 登录响应状态: ${response.status}`);
    const setCookieHeaders = response.headers.getSetCookie();
    let token = null;

    for (const cookieStr of setCookieHeaders) {
        const match = cookieStr.match(/^token=([^;]*)/i);
        if (match) {
            token = match[1];
            logger.debug(`[session] 提取到 token: ${token.substring(0, 8)}...`);
            break;
        }
    }

    logger.debug(`[session] 请求 profile: uuid=${uuid}`);
    const resp2 = await fetch('https://community-web.ccw.site/students/profile', {
        method: 'POST',
        body: JSON.stringify({
            studentNumber: uuid,
        }),
        headers: {
            'Content-Type': 'application/json',
        }
    });
    if (!resp2.ok) {
        logger.error(`[session] profile 请求失败: ${resp2.statusText}`);
        throw new Error(`Failed to fetch profile: ${resp2.statusText}`);
    }
    const profile = await resp2.json();
    const oid = profile.body.studentOid;
    logger.debug(`[session] profile 获取成功: oid=${oid}`);
    const cookie = `token=${token}; cookie-user-id=${oid}`;
    logger.debug(`[session] login 完成: cookie 已构建`);
    return cookie;
};

export { login };
