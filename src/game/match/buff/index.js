import Buff from '../buff/buff.js';
import DamageBuff from '../buff/damage.js';
import FreezeBuff from '../buff/freeze.js';
import StrengthBuff from '../buff/strength.js';
import ReboundBuff from '../buff/rebound.js';

/**
 * Buff 类型注册表
 * 根据 buff id 返回对应的 Buff 子类构造函数
 */
const BUFF_CLASS_MAP = {
    'damage': DamageBuff,
    'freeze': FreezeBuff,
    'strength': StrengthBuff,
    'rebound': ReboundBuff,
};

const getBuffClassById = (id) => {
    return BUFF_CLASS_MAP[id] || Buff;
};

export default getBuffClassById;