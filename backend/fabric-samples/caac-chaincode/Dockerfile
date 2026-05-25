FROM alpine:3.19

RUN apk add --no-cache openjdk11-jre

WORKDIR /chaincode

COPY build/install/caac/ ./

EXPOSE 9999

ENV CHAINCODE_SERVER_ADDRESS=0.0.0.0:9999

ENTRYPOINT ["./bin/caac"]
