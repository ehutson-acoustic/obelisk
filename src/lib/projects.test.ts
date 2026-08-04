import {describe, expect, it} from "vitest";
import type {Project} from "../types";
import {newProject, projectFor, SWATCHES} from "./projects";

function project(dir: string, id = dir): Project {
    return {id, name: id, color: "#000000", dir};
}

describe("projectFor", () => {
    it("matches a file inside a project directory", () => {
        const notes = project("/work/notes");
        expect(projectFor("/work/notes/a/b.md", [notes])).toBe(notes);
    });

    it("prefers the nearest project when one nests inside another", () => {
        const outer = project("/work");
        const inner = project("/work/notes");
        expect(projectFor("/work/notes/b.md", [outer, inner])).toBe(inner);
        expect(projectFor("/work/notes/b.md", [inner, outer])).toBe(inner);
    });

    it("does not match a sibling directory sharing a name prefix", () => {
        expect(projectFor("/work/notes-old/b.md", [project("/work/notes")])).toBeNull();
    });

    it("ignores a trailing separator on the project directory", () => {
        const notes = project("/work/notes/");
        expect(projectFor("/work/notes/b.md", [notes])).toBe(notes);
    });

    it("returns null when nothing contains the path", () => {
        expect(projectFor("/elsewhere/b.md", [project("/work/notes")])).toBeNull();
    });
});

describe("newProject", () => {
    it("names the project after the directory and cycles the swatches", () => {
        expect(newProject("/work/notes", 0)).toMatchObject({
            name: "notes",
            dir: "/work/notes",
            color: SWATCHES[0],
        });
        expect(newProject("/work/notes", SWATCHES.length).color).toBe(SWATCHES[0]);
    });

    it("strips a trailing separator before deriving the name", () => {
        expect(newProject("/work/notes/", 1)).toMatchObject({
            name: "notes",
            dir: "/work/notes",
        });
    });
});
