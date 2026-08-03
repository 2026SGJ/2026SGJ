const collisionLeft = (a, b, speed) => {
    return a.x+speed.x < b.x + b.width &&
           a.x+speed.x + a.width > b.x &&
           a.y < b.y + b.height &&
           a.y + a.height > b.y;
};

const collisionRight = (a, b, speed) => {
    return a.x+speed.x + a.width > b.x &&
           a.x+speed.x < b.x + b.width &&
           a.y < b.y + b.height &&
           a.y + a.height > b.y;
};

const collisionTop = (a, b, speed) => {
    return a.y+speed.y < b.y + b.height &&
           a.y+speed.y + a.height > b.y &&
           a.x < b.x + b.width &&
           a.x + a.width > b.x;
};

const collisionBottom = (a, b, speed) => {
    return a.y+speed.y + a.height > b.y &&
           a.y+speed.y < b.y + b.height &&
           a.x < b.x + b.width &&
           a.x + a.width > b.x;
};

export { collisionLeft, collisionRight, collisionTop, collisionBottom };