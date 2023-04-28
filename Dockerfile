FROM node:16-alpine

WORKDIR /usr

COPY package.json ./
COPY yarn.lock ./
COPY tsconfig.json ./
COPY index.ts ./index.ts

RUN ls -a

RUN yarn --frozen-lockfile

RUN yarn build

## this is stage two , where the app actually runs

FROM node:16-alpine

WORKDIR /usr

COPY package.json ./
COPY yarn.lock ./

RUN yarn --frozen-lockfile --prod

COPY --from=0 /usr/dist .

RUN npm install pm2 -g

EXPOSE 443

CMD ["pm2-runtime","index.js"]