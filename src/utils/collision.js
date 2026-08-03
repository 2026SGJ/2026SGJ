const collisionLeft = (a, b) => {
    return a.x < b.x + b.width &&
           a.x + a.width > b.x &&
           a.y < b.y + b.height &&
           a.y + a.height > b.y;
};

const collisionRight = (a, b) => {
    return a.x + a.width > b.x &&
           a.x < b.x + b.width &&
           a.y < b.y + b.height &&
           a.y + a.height > b.y;
};

const collisionTop = (a, b) => {
    return a.y < b.y + b.height &&
           a.y + a.height > b.y &&
           a.x < b.x + b.width &&
           a.x + a.width > b.x;
};

const collisionBottom = (a, b) => {
    return a.y + a.height > b.y &&
           a.y < b.y + b.height &&
           a.x < b.x + b.width &&
           a.x + a.width > b.x;
};

export { collisionLeft, collisionRight, collisionTop, collisionBottom };