import HEROS from '../../assets/enum/heros/names.js';
import Vec2 from '../../utils/vec2.js';


const SPEED = 15;
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
        this.runAnimate = 0;
        this.animateState = 'idle';
        this.eventHandlers = {};
        this.frame = 0;
        // this.lastAnimateFrame = 0;
        this.on('keyboardEvent', ({ type, key }) => {
            // console.log(type, key);
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
        this.runAnimate = (this.runAnimate + this.speed.length()/20) % 3;
        return `run${Math.trunc(this.runAnimate)}`;
    }

    render() {
        if( this.dx || this.dy) {
            this.speed.add({ x: this.dx * SPEED, y: this.dy * SPEED });
            if (this.speed.x > 25) this.speed.x = 25;
            if (this.speed.y > 25) this.speed.y = 25;
            if (this.speed.x < -25) this.speed.x  -25; 
            if (this.speed.y < -25) this.speed.y  -25; 
        }
        // this.runAnimate = (this.runAnimate+1)%3;
        if (this.speed.lengthSq() <=0.01) {
            this.speed = new Vec2(0, 0);
        }
        this.speed.scale(0.85);
        // const asset = this.animate();
        return [
            {
                type: 'update',
                x: this.x,
                y: this.y,
                asset: `cat_${this.animate()}`,
                isShowed: true,
                id: this.uuid,
                scale: 100,
                dir: 90
            }
        ]
    }
}

export default Player;