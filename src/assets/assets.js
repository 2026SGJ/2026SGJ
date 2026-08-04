import fs from 'fs';
import heros from './enum/heros/index.js';
import minerals from './enum/minerals/index.js';
import maps from './enum/maps/index.js';
import itemAssets from './enum/items/index.js';
import entityAssets, { EntityNames } from './enum/entities/index.js';
import { ItemNames, ItemStates, ItemTypes } from './enum/items/index.js';
import {
    ITEM_CONFIG, ITEM_STOCK, ITEMS_BY_TYPE,
    INVENTORY_LIMITS, ITEM_COOLDOWNS,
    EXPLOSION_CONFIG, EXPLOSION_VISUAL,
    BUFF_PARAMS,
} from './data/items/index.js';

const assets = {
    heros,
    minerals,
    maps,
    items: {
        assets: itemAssets,
        names: ItemNames,
        states: ItemStates,
        types: ItemTypes,
    },
    /** 静态交互实体（商店等）的 asset 映射 */
    entities: {
        assets: entityAssets,
        names: EntityNames,
    },
    data: {
        items: ITEM_CONFIG,
        stock: ITEM_STOCK,
        itemsByType: ITEMS_BY_TYPE,
        inventory: INVENTORY_LIMITS,
        cooldowns: ITEM_COOLDOWNS,
        explosions: EXPLOSION_CONFIG,
        explosionVisual: EXPLOSION_VISUAL,
        buffs: BUFF_PARAMS,
    },
};

export {
    ItemNames, ItemStates, ItemTypes,
    ITEM_CONFIG, ITEM_STOCK, ITEMS_BY_TYPE,
    INVENTORY_LIMITS, ITEM_COOLDOWNS,
    EXPLOSION_CONFIG, EXPLOSION_VISUAL,
    BUFF_PARAMS,
};
export default assets;