import HEROS from '../../assets/enum/heros/names.js';
import Vec2 from '../../utils/vec2.js';

class Player {
    constructor(playerId) {
        this.uuid = playerId;
        this.x = 0;
        this.y = 0;
        this.dir = 90; // 和移动无关，仅决定渲染
        this.speed = new Vec2(0, 0);
        this.dx = 0;
        this.dy = 0;
        this.hero = 'cat';
        this.costume = 'empty';
        this.runAnimate = 0;
        this.animateState = 'idle';
        this.eventHandlers = {};
        this.eventQueue = [];
        // this.frame = 0;
        this.args = {
            speed: 15
        };
        this.buffs = [];
        // this.lastAnimateFrame = 0;
        this.on('keyboardEvent', (a) => {
            this.eventQueue.push(a);
        })
    }

    trigger(type, data) {
        if (!this.eventHandlers[type]) this.eventHandlers[type] = [];
        this.eventHandlers[type].forEach(async _=>{
            try {
                _(data);
            } catch (_) {
                console.error(_);
            }
        });
        // console.log(this.eventHandlers[type]);
    }

    on(type, callback) {
        if (!this.eventHandlers[type]) this.eventHandlers[type] = [];
        this.eventHandlers[type].push(callback);
    }

    animate() {
        if (this.speed.lengthSq() == 0) {
            // console.log(this.speed.x, this.speed.y);
            this.animateState = 'idle';
            return 'idle';
        }
        // console.log(this.runAnimate);
        this.runAnimate = (this.runAnimate + this.speed.length()/(1.41*this.args.speed)) % 3;
        return `run${Math.trunc(this.runAnimate)}`;
    }

    processEvents() {
        while (this.eventQueue.length() > 0) {
            const { type, key } = this.eventQueue.shift();
            if (type === 'KeyHolding') {
                this.dx=this.dy=0;
                key.forEach(_=>{
                    switch ( _ ) {
                        case 'KeyW': 
                            this.dy = 1;
                            break;
                        case 'KeyS':
                            this.dy = -1;
                            break;
                        case 'KeyA':
                            this.dx = -1;
                            this.dir = -90;
                            break;
                        case 'KeyD':
                            this.dx = 1;
                            this.dir = 90;
                            break;
                    }
                })
            }
        }
    }

    move() {
        if( this.dx || this.dy) {
            this.speed.add({ x: this.dx * this.args.speed, y: this.dy * this.args.speed });
            if (this.speed.x > this.args.speed) this.speed.x = this.args.speed;
            if (this.speed.y > this.args.speed) this.speed.y = this.args.speed;
            if (this.speed.x < -this.args.speed) this.speed.x  -this.args.speed; 
            if (this.speed.y < -this.args.speed) this.speed.y  -this.args.speed; 
        }
        // this.runAnimate = (this.runAnimate+1)%3;
        if (this.speed.lengthSq() <=0.01) {
            this.speed = new Vec2(0, 0);
        }
        this.x+=this.speed.x;
        this.y+=this.speed.y;
        this.speed.scale(0.85);
    }

    tick() {
        this.move();
        this.costume = `cat_${this.animate()}`;
    }

    render() {
        return [
            {
                type: 'update',
                x: this.x,
                y: this.y,
                asset: this.costume,
                isShowed: true,
                id: this.uuid,
                scale: 100,
                dir: this.dir
            }
        ]
    }
}

export default Player;