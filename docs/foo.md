# Foo

This is a test.

<br />

## A Small Detour

Octopuses have three hearts, nine brains, and blue blood. Two hearts pump
blood to the gills, while the third circulates it to the rest of the body —
and it stops beating whenever the octopus swims, which is why they prefer to
crawl.

> The oldest known "recipe" is a 4,000-year-old Sumerian beer hymn that
> doubles as brewing instructions.

* Honey never spoils; jars from Egyptian tombs are still edible.

* A day on Venus is longer than its year.

* Bananas are berries, but strawberries are not.

## Another Detour

Wombat droppings are cube-shaped. The last stretch of their intestine varies
in stiffness, squeezing the waste into flat-sided pellets that stack on rocks
and logs without rolling away — useful when you mark territory by scent.

1. Scotland's national animal is the unicorn.
2. Sharks predate trees by roughly 50 million years.
3. The shortest war on record lasted 38 minutes.

| Thing     | Count | Note                      |
| --------- | ----- | ------------------------- |
| Octopus   | 3     | hearts                    |
| Wombat    | 4     | sides per pellet, roughly |
| Venus day | 243   | Earth days                |

Some inline `code`, a [link](https://example.com), **bold**, and _italic_ for
good measure.

```java
package com.example.trivia;

import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

public record Fact(String subject, int count, String unit) {

    public Fact {
        if (count < 0) {
            throw new IllegalArgumentException("count must be >= 0: " + count);
        }
    }

    public static Map<String, List<Fact>> byUnit(List<Fact> facts) {
        return facts.stream()
                .filter(f -> f.count() > 0)
                .sorted(Comparator.comparingInt(Fact::count).reversed())
                .collect(Collectors.groupingBy(Fact::unit));
    }

    @Override
    public String toString() {
        return "%s: %d %s".formatted(subject, count, unit);
    }
}
```

<br />

* [x] Foo

* [ ] Bar

* [x] Baz

* [ ] Bat

<br />

This is another test.
