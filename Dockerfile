FROM oven/bun:latest
WORKDIR /src
COPY ./ ./
RUN bun install
EXPOSE 3001
CMD ["bun", "run", "start"]