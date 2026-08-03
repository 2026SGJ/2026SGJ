const matchLoop= async (players, world) => {
    for(const i in players){
        (i=>{
            i.tick(players, world);
        })(players[i]);
    }
};

export {
    matchLoop
};