const matchLoop= async (players, world) => {
    for(const i in players){
        (i=>{
            i.tick(players);
        })(players[i]);
    }
};

export {
    matchLoop
};