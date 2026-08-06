const login = async (uuid, pass) => {
    const response = await fetch('https://sso.ccw.site/web/auth/login-by-password', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36'
        },
        body: JSON.stringify({"loginKey":uuid,"clientCode":"STUDY_COMMUNITY","password":pass,"extra":"{\"device\":\"Windows 10\",\"browser\":\"Chrome 146\",\"scene\":null}"})
    });
    if (!response.ok) {
        throw new Error(`Login failed: ${response.statusText}`);
    }
    // const token = (await response.json()).body.token;
    const setCookieHeaders = response.headers.getSetCookie();
    let token = null;

    for (const cookieStr of setCookieHeaders) {
        const match = cookieStr.match(/^token=([^;]*)/i);
        if (match) {
            token = match[1];
            break;
        }
    }

    // console.log(await response.json())

    const resp2 = await fetch('https://community-web.ccw.site/students/profile', {
        method: 'POST',
        body: JSON.stringify({
            studentNumber: uuid,
        }),
        headers: {
            'Content-Type': 'application/json',
        }
    })
    if (!resp2.ok) {
        throw new Error(`Failed to fetch profile: ${resp2.statusText}`);
    }
    const profile = await resp2.json();
    const oid = profile.body.studentOid;
    return `token=${token}; cookie-user-id=${oid}`;
}

export { login };