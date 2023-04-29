import {
  adjectives,
  animals,
  colors,
  Config,
  uniqueNamesGenerator,
} from "unique-names-generator";
import WebSocket, { WebSocketServer } from "ws";
import https from "https";
import fs from "fs";
import express from "express";

let wss: WebSocketServer;
// If we were started in "secure mode", read the certificate
console.log("ENVIRONMENT MODE IS " + process.env.MODE);
if (process.env.MODE === "secure") {
  var privateKey = fs.readFileSync("/certs/server.key", "utf8");
  var certificate = fs.readFileSync("/certs/server.cert", "utf8");

  // Below is only for when running locally and you can't create
  // a /certs dir
  // var privateKey = fs.readFileSync("./server.key", "utf8");
  // var certificate = fs.readFileSync("./server.cert", "utf8");
  var credentials = { key: privateKey, cert: certificate };
  const app = express();

  const httpsServer = https.createServer(credentials, app);
  httpsServer.listen(3333, () => {
    console.log("SECURE WSS server started on port 3333");
  });

  wss = new WebSocketServer({ server: httpsServer });
} else {
  wss = new WebSocketServer({ host: "0.0.0.0", port: 3333 });
  console.log("INSECURE WS server started on port 3333");
}

interface IConnectionInfo {
  websocket: WebSocket.WebSocket;
  playerRef: string;
}

interface IGameInfo {
  [key: string]: {
    playerConnections: IConnectionInfo[];
    // latestVerifiedState: any;
  };
}

interface IMessage {
  type: string;
  game?: string;
  payload: any;
}

let games: IGameInfo = {};

const debugPrintGames = (games: IGameInfo) => {
  console.log("------GAMES-------");
  console.log(
    JSON.stringify(
      games,
      (key, value) => {
        return key === "websocket" ? `WS state: ${value.readyState}` : value;
      },
      2
    )
  );
  console.log("------END GAMES---");
};

const getGamesWithConnection = (
  ws: WebSocket.WebSocket,
  games: IGameInfo
): string[] => {
  return Object.keys(games).filter((game) =>
    games[game].playerConnections.map((pc) => pc.websocket).includes(ws)
  );
};

const getPlayerRefInfoForConnection = (
  ws: WebSocket.WebSocket,
  games: IGameInfo
): string[] => {
  return getGamesWithConnection(ws, games).map(
    (game) =>
      games[game].playerConnections.find((pc) => pc.websocket === ws)?.playerRef
  );
};

const notifyLeftGame = (
  games: IGameInfo,
  affectedGames: string[],
  playerRefs: string[]
) => {
  if (affectedGames.length !== playerRefs.length) {
    console.error("Should have the same number of refs and games");
    return;
  }

  affectedGames.forEach((g, index) => {
    const connections = games[g]?.playerConnections ?? [];
    connections.forEach((pc) => {
      console.log(
        `notifying ${pc.playerRef} that ${playerRefs[index]} left the game`
      );
      const c = pc.websocket;
      if (c.readyState === WebSocket.OPEN) {
        console.log("sending");
        c.send(
          JSON.stringify({
            type: "playerleft",
            payload: {
              playerRef: playerRefs[index],
            },
          })
        );
      }
    });
  });
};

const removeConnectionFromGames = (
  ws: WebSocket.WebSocket,
  games: IGameInfo
): IGameInfo => {
  Object.keys(games).forEach((game) => {
    if (games[game].playerConnections.map((pc) => pc.websocket).includes(ws)) {
      games[game].playerConnections = games[game].playerConnections.filter(
        (pc) => pc.websocket !== ws
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
          playerConnections: [
            { websocket: ws, playerRef: message.payload.playerRef },
          ],
        };

        console.log("NEW GAME");
        debugPrintGames(games);

        ws.send(
          JSON.stringify({
            type: "newgamecreated",
            payload: gameName,
          })
        );
      } else if (message.type === "connecttogame") {
        console.log(
          "connecting to game " + JSON.stringify(message.payload, null, 2)
        );
        const game = games[message.payload.game];
        let hostClient: IConnectionInfo | null = null;
        if (game) {
          // remove from any other games and get the "primary host"
          games = removeConnectionFromGames(ws, games);
          hostClient = games[message.payload.game].playerConnections[0];
        } else {
          // create the game because it didn't exist
          games[message.payload.game] = { playerConnections: [] };
        }

        games[message.payload.game].playerConnections.push({
          websocket: ws,
          playerRef: message.payload.playerRef,
        });
        ws.send(
          JSON.stringify({
            type: "connectedtogame",
            payload: message.payload.game,
          })
        );

        if (!!hostClient) {
          hostClient.websocket.send(
            JSON.stringify({
              type: "newplayerconnected",
              payload: {
                playerRef: message.payload.playerRef,
              },
            })
          );
        }

        debugPrintGames(games);
      } else if (message.type === "remoteaction") {
        // console.log("received remote action", message);
        const clientsInGame = games[message.game]?.playerConnections ?? [];
        clientsInGame.forEach((pc) => {
          const client = pc.websocket;
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
          clientsInGame[0].websocket.send(JSON.stringify(message));
        }
      }
    } catch (e) {
      console.error(e);
    }
  });

  ws.on("close", () => {
    console.log(`websocket closed`);
    // First, get a list of all the games this ws was part of
    const affectedGames = getGamesWithConnection(ws, games);
    console.log(`Found ${affectedGames.length} affected games`);

    const playerRefInfoFromGames = getPlayerRefInfoForConnection(ws, games);
    games = removeConnectionFromGames(ws, games);
    debugPrintGames(games);

    // Now, notify all the other clients that someone left
    // the game
    notifyLeftGame(games, affectedGames, playerRefInfoFromGames);
  });

  ws.on("error", () => {
    console.log(`websocket errored`);
    // First, get a list of all the games this ws was part of
    const affectedGames = getGamesWithConnection(ws, games);
    console.log(`Found ${affectedGames.length} affected games`);

    const playerRefInfoFromGames = getPlayerRefInfoForConnection(ws, games);
    games = removeConnectionFromGames(ws, games);
    debugPrintGames(games);

    // Now, notify all the other clients that someone left
    // the game
    notifyLeftGame(games, affectedGames, playerRefInfoFromGames);
  });
});
