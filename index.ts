import {
  adjectives,
  animals,
  colors,
  Config,
  uniqueNamesGenerator,
} from "unique-names-generator";
import WebSocket, { WebSocketServer } from "ws";

const wss = new WebSocketServer({ host: "0.0.0.0", port: 8080 });

interface IGameInfo {
  [key: string]: {
    playerConnections: WebSocket.WebSocket[];
  };
}

interface IMessage {
  type: string;
  game?: string;
  payload: any;
}

let games: IGameInfo = {};

const removeConnectionFromGames = (
  ws: WebSocket.WebSocket,
  games: IGameInfo
): IGameInfo => {
  Object.keys(games).forEach((game) => {
    if (games[game].playerConnections.includes(ws)) {
      games[game].playerConnections = games[game].playerConnections.filter(
        (w) => w !== ws
      );
    }
  });

  return games;
};

wss.on("connection", (ws) => {
  console.log("new connection");

  ws.on("message", (data, isBinary) => {
    try {
      const message: IMessage = JSON.parse(data.toString());
      if (message.type === "newgame") {
        const customConfig: Config = {
          dictionaries: [adjectives, colors, animals],
          separator: "-",
          length: 3,
          style: "lowerCase",
        };
        const gameName = uniqueNamesGenerator(customConfig);
        games[gameName] = {
          playerConnections: [ws],
        };

        console.log("NEW GAME");
        console.log(games);

        ws.send(
          JSON.stringify({
            type: "newgamecreated",
            payload: gameName,
          })
        );
      } else if (message.type === "connecttogame") {
        console.log("connecting to game " + message.payload);
        const game = games[message.payload.game];
        if (game) {
          // remove from any other games
          games = removeConnectionFromGames(ws, games);
          const hostClient = games[message.payload.game].playerConnections[0];
          games[message.payload.game].playerConnections.push(ws);
          ws.send(
            JSON.stringify({
              type: "connectedtogame",
              payload: message.payload.game,
            })
          );

          if (!!hostClient) {
            hostClient.send(
              JSON.stringify({
                type: "newplayerconnected",
                payload: {
                  playerRef: message.payload.playerRef,
                },
              })
            );
          }
        }
        console.log(games);
      } else if (message.type === "remoteaction") {
        console.log("received remote action", message);
        const clientsInGame = games[message.game]?.playerConnections ?? [];
        clientsInGame.forEach((client) => {
          if (client !== ws && client.readyState === WebSocket.OPEN) {
            client.send(data, { binary: isBinary });
          }
        });
      } else if (message.type === "resync") {
        console.log("received resync request for game " + message.game);

        //Just use the first connection as the "host"
        const clientsInGame = games[message.game]?.playerConnections ?? [];
        if (clientsInGame.length > 0) {
          message.type = "remoteaction";
          clientsInGame[0].send(JSON.stringify(message));
        }
      }
    } catch (e) {
      console.error(e);
    }
  });

  ws.on("close", () => {
    console.log(`websocket closed`);
    games = removeConnectionFromGames(ws, games);
    console.log(games);
  });

  ws.on("error", () => {
    console.log(`websocket errored`);
    games = removeConnectionFromGames(ws, games);
    console.log(games);
  });
});

console.log("server started");
