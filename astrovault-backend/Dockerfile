FROM maven:3.9.8-eclipse-temurin-21 AS builder
WORKDIR /app
COPY pom.xml .
COPY src ./src
RUN mvn -DskipTests package quarkus:build

FROM eclipse-temurin:25-jre
WORKDIR /app
COPY --from=builder /app/target/quarkus-app/ /app/
EXPOSE 8080
CMD ["java", "-jar", "/app/quarkus-run.jar"]
