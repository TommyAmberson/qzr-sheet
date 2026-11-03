# Contract: the schedule file

One schedule document, as JSON: what the builder keeps in the browser, saves to a file, and sends to
and receives from the API. Its fields are in [data-model.md](../data-model.md); this page covers
what readers and writers promise each other.

* **Extension**: `.qzrschedule.json`, so it opens anywhere as JSON and the scoresheet's quiz files
  aren't mistaken for it.
* **Version**: `version` is `SCHEDULE_FILE_VERSION`, starting at 1, and is independent of the
  scoresheet's `FILE_VERSION`. A reader:
  * opens its own version and every earlier one, filling what an earlier version lacked with
    defaults;
  * refuses a newer version with a message naming both versions, and leaves what's open untouched;
  * refuses a document that fails validation with a message saying what's wrong.
* **Round trip**: saving and reopening gives an identical document, pins and draw included (SC-006).
* **Ids**: quiz, slot, room and division ids are strings and stable for the document's life. A
  seat's "place in another quiz" names the quiz by id. Ids from converted meets are the old row ids
  as strings.
* **Linked rooms and times**: when linked, a room may name its meet room (`meetRoomId`); publishing
  adds a meet room for each room without one and fills it in. `link.timeZone`, the meet's time zone,
  turns a day's times into the instants the meet's old read routes return. Each day row is the first
  date on its weekday from the meet's `dateFrom`, or from the day before it, on.
* **Team names**: present only in the draw. A published document in letters view has them, and the
  meet's team ids, removed, in letter order (see [api.md](./api.md)).
* **Contract version**: the codec and validation live in `packages/shared`, so a change to the
  document's shape is a `@qzr/shared` contract change: additive is MINOR; one that an older builder
  can't read is MAJOR and raises `SCHEDULE_FILE_VERSION` (Principle V).

## Links

| Link                                | Means                                                            | Who builds it             |
| ----------------------------------- | ---------------------------------------------------------------- | ------------------------- |
| portal `/builder`                   | the builder: its list of schedules kept in this browser, and new | the portal's home page    |
| portal `/builder/<id>`              | a schedule kept in this browser                                  | the builder's list        |
| portal `/<slug>/schedule/edit`      | the meet's linked schedule in the builder (admins)               | the meet's Schedule tab   |
| scoresheet `?meetId=<id>&quiz=<id>` | open a scheduled quiz, unchanged; `quiz` is a document quiz id   | portal `ScheduleView.vue` |

The scoresheet link keeps its shape, so links already shared keep working: converted meets keep the
old quiz row ids as document ids.
