import render from "./render.js";

const matchLoop= async (players) => {
    for(const i in players){
        (i=>{
            render(i.uuid, i.render());
        })(players[i]);
    }
};

export {
    matchLoop
};