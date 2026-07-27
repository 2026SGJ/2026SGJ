import actions from './actions.js';
import names from './names.js';

let heros = {};

for (const i in names) {
    for (const j in actions) {
        heros[`${i}_${j}`] = `${names[i]}_${actions[j]}`;
    }
}

export default heros;