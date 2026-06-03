FROM node:20-alpine AS frontend-build
WORKDIR /src

COPY package.json package-lock.json ./
COPY tsconfig.json vite.config.ts index.html ./
COPY public ./public
COPY src ./src

RUN npm ci
RUN npm run build

FROM mcr.microsoft.com/dotnet/sdk:8.0 AS backend-publish
WORKDIR /src

COPY api ./api
COPY --from=frontend-build /src/dist ./api/wwwroot

RUN dotnet publish ./api/TeamleaderDashboard.Api.csproj -c Release -o /app/publish

FROM mcr.microsoft.com/dotnet/aspnet:8.0 AS runtime
WORKDIR /app

COPY --from=backend-publish /app/publish ./

EXPOSE 8080

ENTRYPOINT ["dotnet", "TeamleaderDashboard.Api.dll"]
