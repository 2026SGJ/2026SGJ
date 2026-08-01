import Buff from '../buff/buff.js';
import DamageBuff from '../buff/damage.js';

const getBuffClassById = (id) => {
    switch (id) {
        case 'damage':
            return DamageBuff;
        // 可以在这里添加更多的 Buff 类型
        default:
            return Buff; // 默认返回基础 Buff 类
    }
};

export default getBuffClassById;