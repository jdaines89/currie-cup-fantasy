import { describe, expect, it } from "vitest";
import { encodeMentions, splitMentions, typingTag } from "../src/lib/mentions";

const andy = { user_id: "00000000-0000-0000-0000-00000000000b", display_name: "Andy" };
const andyB = { user_id: "00000000-0000-0000-0000-00000000000d", display_name: "Andy B" };
const christo = { user_id: "00000000-0000-0000-0000-00000000000c", display_name: "Christo" };

describe("chat tags", () => {
  it("stores a tag as the person's id", () => {
    expect(encodeMentions("@Christo did you see that tackle?", [andy, christo]))
      .toBe("<@00000000-0000-0000-0000-00000000000c> did you see that tackle?");
  });

  it("prefers the longer name", () => {
    expect(encodeMentions("@Andy B and @Andy", [andy, andyB]))
      .toBe("<@00000000-0000-0000-0000-00000000000d> and <@00000000-0000-0000-0000-00000000000b>");
  });

  it("leaves emails and partial words alone", () => {
    expect(encodeMentions("mail me@Andyson.com", [andy])).toBe("mail me@Andyson.com");
  });

  it("splits a stored message back into text and tags", () => {
    expect(splitMentions("<@00000000-0000-0000-0000-00000000000b> looks like you're taking this!"))
      .toEqual([{ userId: "00000000-0000-0000-0000-00000000000b" }, { text: " looks like you're taking this!" }]);
  });

  it("spots a tag being typed", () => {
    expect(typingTag("nice one @Chr")).toBe("Chr");
    expect(typingTag("nice one @")).toBe("");
    expect(typingTag("no tag here")).toBeNull();
  });
});
