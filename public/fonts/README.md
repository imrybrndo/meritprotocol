# Brand fonts

`app/globals.css` declares two variable faces and loads them from this folder:

| File                            | Family              | Weight range | Used for            |
| ------------------------------- | ------------------- | ------------ | ------------------- |
| `ReferenceSans-Variable.woff2`  | `Reference Sans`    | 100–900      | UI, nav, body, CTAs |
| `ReferenceDisplay-Variable.woff2` | `Reference Display` | 400–900      | `.hero-title` only  |

The files are not in the repo. Until they are dropped in here, each `@font-face`
falls through its `local()` source to `Arial, sans-serif`, so the layout still
renders — with different metrics — and the browser logs a 404 per face.
