# Price history

Raccolta pubblica dei prezzi di mercato FUT.GG per EA FC 27, Console e PC.
GitHub Actions scarica l'intero listino alle :07, :22, :37 e :52 di ogni ora UTC.
Conserva le osservazioni delle ultime 24 ore, senza un PC acceso.

## Avvio

1. Pubblica questi file sul ramo `main` del repository.
2. In **Actions > Collect price history**, controlla la prima esecuzione, oppure usa **Run workflow**.
3. Se le policy negano la scrittura, abilitala in **Settings > Actions > General >
   Workflow permissions > Read and write permissions**.
4. La prima esecuzione riuscita crea il ramo `data`. Dopo 24 ore si forma la finestra completa.

Non occorrono token personali, account EA, credenziali FUT.GG o dipendenze npm.
Il workflow usa il `GITHUB_TOKEN` temporaneo di GitHub esclusivamente per pubblicare i dati.
Usa runner standard `ubuntu-latest`, gratuiti nei repository pubblici secondo le condizioni GitHub.

## Dati pubblicati

Il ramo `main` contiene solo raccoglitore, test, istruzioni e workflow. Il ramo `data` contiene:

- `manifest.json`: orari UTC delle osservazioni in millisecondi Unix, conteggi, edizione,
  numero di gruppi e data di pubblicazione dei feed sorgente quando disponibile.
- `listino-console.json`, `listino-pc.json`: ultimo listino compatto `{v:2,id0,d,p,n}`.
- `history/console/00.json` ... `31.json`, con gli stessi gruppi per `history/pc/`.
- `times.json`: indice degli orari di acquisizione.
- `snapshots/<timestamp>-console.json` e `snapshots/<timestamp>-pc.json`: listini
  compatti di ogni osservazione, per calcolare i movimenti dell'intero mercato
  con un solo download. Il manifesto segnala questa disponibilità con `snapshots: true`.

Indirizzo pubblico del manifesto:

`https://raw.githubusercontent.com/iamlucaconti/price-history/data/manifest.json`

Per leggere una carta usa il **definitionId/Item ID della versione esatta EA**:

```js
const group = String(definitionId % 32).padStart(2, '0');
const url = `https://raw.githubusercontent.com/iamlucaconti/price-history/data/history/${platform}/${group}.json`;
const data = await fetch(url).then(response => response.json());
const series = data.times.map((when, i) => ({ when, price: data.prices[definitionId]?.[i] ?? null }));
```

`platform` vale `console` o `pc`. I gruppi evitano di scaricare lo storico dell'intero gioco
per consultare una carta. I valori null indicano prezzi non disponibili; i costi delle SBC
e le carte obiettivo/non commerciabili non diventano prezzi di mercato.

## Precisione e limiti

- Le date sono **date di osservazione del listino**, non vendite EA o aggiornamenti individuali
  delle carte. La fonte può conservare un prezzo invariato o aggiornarsi in ritardo.
- La raccolta parte dall'attivazione: nessun recupero retroattivo delle 24 ore precedenti.
- Fino a 97 osservazioni includono i due estremi delle 24 ore. Più esecuzioni nello stesso
  quarto d'ora sostituiscono l'ultima osservazione di quel quarto d'ora.
- GitHub può ritardare o saltare esecuzioni. Errori di rete, blocchi FUT.GG o dati incoerenti
  fanno fallire il lavoro senza pubblicare osservazioni. I buchi restano reali.
- Entrambe le piattaforme e i feed dinamici devono essere disponibili prima di pubblicare.
- Il ramo `data` viene rigenerato con un solo commit per non conservare una cronologia Git
  illimitata visibile. Non basare altro lavoro su quel ramo: viene aggiornato con force push.
  La pulizia degli oggetti Git non più raggiungibili è gestita da GitHub.
- I workflow pianificati possono essere disabilitati dopo 60 giorni senza attività nel
  repository: controlla Actions e riabilita il workflow se necessario.

## Sviluppo locale

Richiede Node.js 22 o successivo:

```text
npm test
node collect.mjs --previous state --output public
```

`state` è una copia precedente del ramo `data`; se manca, parte una raccolta nuova.
Ingresso e uscita devono essere directory diverse. I dati generati sono esclusi da Git.
Su Windows, se servono i certificati di sistema: `node --use-system-ca collect.mjs` con Node 24.

La fonte è `https://r2.fut.gg/27/manifest.json` e le risorse versionate indicate nel manifesto.
Il raccoglitore non aggira blocchi di accesso.

Documentazione: [GitHub Actions schedule](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule),
[costi GitHub Actions](https://docs.github.com/en/billing/concepts/product-billing/github-actions).
