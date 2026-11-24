{{#if texto}}{{texto}}{{else}}({{quem}} mandou só os anexos.){{/if}}

[Anexos de {{quem}}]
{{#each anexos}}
- {{caminho}} ({{tipo}}, {{tamanho}}{{#if imagem}}; vai junto como imagem{{/if}})
{{/each}}
