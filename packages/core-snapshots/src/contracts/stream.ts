import { StreamReader, StreamWriter } from "../filesystem";

export type StreamReaderFactory = (file: string, useCompression: boolean, decode: Function) => StreamReader;

export type StreamWriterFactory = (
    dbStream: NodeJS.ReadableStream,
    file: string,
    useCompression: boolean,
    encode: Function,
) => StreamWriter;

type ListenerFunction = (...data) => void;

export interface EventListenerPair {
    event: string;
    listener: ListenerFunction;
}
