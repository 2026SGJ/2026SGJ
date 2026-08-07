import fs from "fs";
import heros from "./enum/heros/index.js";
import minerals from "./enum/minerals/index.js";
import maps from "./enum/maps/index.js";
import itemAssets from "./enum/items/index.js";
import entityAssets, { EntityNames } from "./enum/entities/index.js";
import guiAssets, { GuiNames } from "./enum/gui/index.js";
import areaAssets, { AreaNames } from "./enum/areas/index.js";
import { ItemNames, ItemStates, ItemTypes } from "./enum/items/index.js";
import {
	ITEM_CONFIG,
	ITEM_STOCK,
	ITEMS_BY_TYPE,
	INVENTORY_LIMITS,
	ITEM_COOLDOWNS,
	EXPLOSION_CONFIG,
	EXPLOSION_VISUAL,
	BUFF_PARAMS,
} from "./data/items/index.js";

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
	/** 地图区域区块（640×360）的 asset 映射 */
	areas: {
		assets: areaAssets,
		names: AreaNames,
	},
	/** 屏幕固定 GUI（商店面板 / 商品槽 / 光标等）的 asset 映射 */
	gui: {
		assets: guiAssets,
		names: GuiNames,
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
	ItemNames,
	ItemStates,
	ItemTypes,
	AreaNames,
	ITEM_CONFIG,
	ITEM_STOCK,
	ITEMS_BY_TYPE,
	INVENTORY_LIMITS,
	ITEM_COOLDOWNS,
	EXPLOSION_CONFIG,
	EXPLOSION_VISUAL,
	BUFF_PARAMS,
};
export default assets;
