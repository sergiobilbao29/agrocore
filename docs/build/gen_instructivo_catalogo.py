# -*- coding: utf-8 -*-
"""Instructivo: Centros de costo (PDF, estilo AgroCore)."""
import os
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import (BaseDocTemplate, PageTemplate, Frame, Paragraph,
                                Spacer, Table, TableStyle, ListFlowable, ListItem)

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(BASE, "Instructivos", "Instructivo-Catalogo-Articulos.pdf")
LOGO = os.path.join(BASE, "..", "web", "img", "logo-full-256.png")

G900 = colors.HexColor("#14532d"); G700 = colors.HexColor("#15803d")
G600 = colors.HexColor("#16a34a"); G100 = colors.HexColor("#dcfce7")
AMBER_BG = colors.HexColor("#fef3c7"); AMBER_BD = colors.HexColor("#f59e0b"); AMBER_TX = colors.HexColor("#92400e")
BLUE_BG = colors.HexColor("#e0f2fe"); BLUE_BD = colors.HexColor("#38bdf8"); BLUE_TX = colors.HexColor("#075985")
SLATE = colors.HexColor("#475569")

styles = getSampleStyleSheet()
def S(name, **kw): return ParagraphStyle(name, parent=styles["Normal"], **kw)
st_title = S("t", fontName="Helvetica-Bold", fontSize=21, textColor=G900, spaceAfter=2, leading=25)
st_sub   = S("s", fontName="Helvetica", fontSize=11, textColor=SLATE, spaceAfter=10, leading=15)
st_intro = S("i", fontName="Helvetica", fontSize=10.5, textColor=colors.HexColor("#1f2937"), leading=16, spaceAfter=6)
st_h2    = S("h2", fontName="Helvetica-Bold", fontSize=13.5, textColor=G700, spaceBefore=12, spaceAfter=6, leading=17)
st_step  = S("step", fontName="Helvetica", fontSize=10.5, textColor=colors.HexColor("#111827"), leading=16)
st_faq_q = S("faqq", fontName="Helvetica-Bold", fontSize=10.5, textColor=G900, leading=15, spaceBefore=6)
st_faq_a = S("faqa", fontName="Helvetica", fontSize=10.5, textColor=colors.HexColor("#1f2937"), leading=15)
st_cell  = S("cell", fontName="Helvetica", fontSize=9, leading=12, textColor=colors.HexColor("#1f2937"))
st_cellb = S("cellb", fontName="Helvetica-Bold", fontSize=9, leading=12, textColor=G900)

def callout(text, bg, bd, tx):
    p = Paragraph(text, S("c", fontName="Helvetica", fontSize=10, leading=15, textColor=tx))
    t = Table([[p]], colWidths=[165*mm])
    t.setStyle(TableStyle([("BACKGROUND",(0,0),(-1,-1),bg),("BOX",(0,0),(-1,-1),1.2,bd),
        ("LEFTPADDING",(0,0),(-1,-1),10),("RIGHTPADDING",(0,0),(-1,-1),10),
        ("TOPPADDING",(0,0),(-1,-1),8),("BOTTOMPADDING",(0,0),(-1,-1),8)]))
    return t

def steps(items):
    return ListFlowable([ListItem(Paragraph(t, st_step), value=i+1, leftIndent=6) for i,t in enumerate(items)],
        bulletType="1", bulletFontName="Helvetica-Bold", bulletColor=G600, leftIndent=16,
        bulletFontSize=10.5, spaceBefore=2, spaceAfter=2)

def bullets(items):
    return ListFlowable([ListItem(Paragraph(t, st_step), leftIndent=6) for t in items],
        bulletType="bullet", bulletChar="•", bulletColor=G600, leftIndent=16,
        bulletFontSize=10.5, spaceBefore=1, spaceAfter=1)

def tabla(data, anchos):
    rows = []
    for r_i, row in enumerate(data):
        rows.append([Paragraph(c, st_cellb if r_i==0 else st_cell) for c in row])
    t = Table(rows, colWidths=anchos, repeatRows=1)
    t.setStyle(TableStyle([
        ("BACKGROUND",(0,0),(-1,0),G100),
        ("GRID",(0,0),(-1,-1),0.5,colors.HexColor("#cbd5e1")),
        ("VALIGN",(0,0),(-1,-1),"TOP"),
        ("LEFTPADDING",(0,0),(-1,-1),5),("RIGHTPADDING",(0,0),(-1,-1),5),
        ("TOPPADDING",(0,0),(-1,-1),4),("BOTTOMPADDING",(0,0),(-1,-1),4),
    ]))
    return t

def header_footer(canvas, doc):
    canvas.saveState(); w, h = A4
    canvas.setFillColor(G900); canvas.rect(0, h-24*mm, w, 24*mm, fill=1, stroke=0)
    try: canvas.drawImage(LOGO, 15*mm, h-21*mm, width=16*mm, height=13.7*mm, preserveAspectRatio=True, mask='auto')
    except Exception: pass
    canvas.setFillColor(colors.white); canvas.setFont("Helvetica-Bold", 13); canvas.drawString(34*mm, h-15*mm, "AgroCore")
    canvas.setFont("Helvetica", 10); canvas.drawRightString(w-15*mm, h-15*mm, "Instructivo")
    canvas.setStrokeColor(G100); canvas.setLineWidth(0.6); canvas.line(15*mm, 15*mm, w-15*mm, 15*mm)
    canvas.setFillColor(SLATE); canvas.setFont("Helvetica", 8)
    canvas.drawString(15*mm, 10*mm, "AgroCore - El corazón del negocio agrícola")
    canvas.drawRightString(w-15*mm, 10*mm, "Página %d" % doc.page)
    canvas.restoreState()

def build():
    doc = BaseDocTemplate(OUT, pagesize=A4, leftMargin=15*mm, rightMargin=15*mm, topMargin=30*mm, bottomMargin=20*mm)
    frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id='f')
    doc.addPageTemplates([PageTemplate(id='main', frames=[frame], onPage=header_footer)])
    E = []
    E.append(Paragraph("Catálogo de artículos: configuración y uso correcto", st_title))
    E.append(Paragraph("Cómo organizar tus Categorías, Familias y Subfamilias y cargar tus artículos una sola vez, bien", st_sub))
    E.append(Paragraph(
        "Todo lo que tu empresa compra, vende, consume, fabrica o tiene en stock es un <b>artículo</b>. Para encontrarlo rápido "
        "y que no se dupliquen, los artículos se <b>organizan en un árbol</b>: Categoría &rarr; Familia &rarr; Subfamilias. "
        "Este instructivo te muestra cómo armar ese árbol y cómo cargar cada artículo de forma que funcione en compras, ventas, "
        "stock y producción sin crear copias innecesarias. Sirve igual para una <b>fábrica</b>, un <b>comercio</b> o un campo.", st_intro))
    E.append(callout("<b>La idea en una línea:</b> &nbsp; armás el árbol (Categoría &rarr; Familia &rarr; Subfamilias) &rarr; "
                     "cargás cada artículo UNA vez y le marcás qué puede hacer (se compra / se vende / stock / producción / servicio) "
                     "&rarr; el mismo artículo sirve en todos los circuitos.", G100, G600, G900))

    # Conceptos
    E.append(Paragraph("1 &nbsp;&mdash;&nbsp; Los cuatro conceptos (no los confundas)", st_h2))
    E.append(tabla([
        ["Concepto", "Qué es", "Ejemplo"],
        ["Categoría / Rubro", "La agrupación principal (lo más general).", "Agroindustria, Lubricantes, Animales"],
        ["Familia", "Un grupo de artículos dentro de la categoría.", "Soja, Aceites de motor, Vacunos"],
        ["Subfamilia", "Subdivisión de una familia. Podés anidar las que quieras, sin límite.", "Derivados, 15W40, Terneros"],
        ["Artículo", "La cosa real que opera (se compra/vende/consume/fabrica).", "Expeller de soja, Aceite 15W40 x4 L, Novillo"],
    ], [38*mm, 82*mm, 45*mm]))
    E.append(callout("<b>Clave:</b> la <b>Categoría/Familia/Subfamilia organiza</b>; el <b>Artículo opera</b>. Una familia NO se compra "
                     "ni se vende: es una carpeta. Lo que se compra y se vende es el artículo que está adentro.", AMBER_BG, AMBER_BD, AMBER_TX))
    E.append(callout("<b>Dónde está cada cosa:</b> el árbol se arma en <b>Administración &rarr; Organización de artículos</b> "
                     "(antes se llamaba &ldquo;Categorías y Familias&rdquo;). Los artículos se cargan y consultan en "
                     "<b>Catálogo de artículos</b> (antes &ldquo;Catálogos&rdquo;).", BLUE_BG, BLUE_BD, BLUE_TX))

    # PASO 1 arbol
    E.append(Paragraph("PASO 1 &nbsp;&mdash;&nbsp; Armar el árbol (Organización de artículos)", st_h2))
    E.append(steps([
        "Entrá a <b>Administración &rarr; Organización de artículos</b>. Si está vacío, el sistema te ofrece crear un árbol sugerido por defecto.",
        "Con <b>+ Nueva categoría</b> creás las categorías principales (Agroindustria, Lubricantes, Insumos, Animales...).",
        "Dentro de cada categoría, con el botón <b>+ Familia</b> agregás sus familias; y dentro de una familia podés seguir agregando <b>subfamilias</b> (sin límite de niveles).",
        "Cada nodo muestra entre paréntesis <b>cuántos artículos contiene</b> (sumando sus subfamilias). Podés renombrar, mover (eligiendo de qué nodo depende) o desactivar.",
        "No se permiten dos nodos con el <b>mismo nombre bajo el mismo padre</b> (confunde). El mismo nombre en ramas distintas sí se permite.",
    ]))
    E.append(callout("<b>Mover sin romper:</b> para mover una familia a otro lugar, editala y cambiá <b>&ldquo;Depende de&rdquo;</b>. El sistema "
                     "no te deja colgarla de sí misma ni de una de sus subfamilias (evita bucles). Mover NO toca saldos, precios ni movimientos.",
                     AMBER_BG, AMBER_BD, AMBER_TX))

    # Ejemplos
    E.append(Paragraph("2 &nbsp;&mdash;&nbsp; Dos ejemplos para copiar", st_h2))
    E.append(Paragraph("<b>Fábrica (molienda de soja):</b>", st_intro))
    E.append(bullets([
        "Categoría <b>Agroindustria</b> &rarr; Familia <b>Soja</b> &rarr; Subfamilia <b>Granos</b> &rarr; artículo <b>Soja en grano</b>.",
        "Categoría <b>Agroindustria</b> &rarr; Familia <b>Soja</b> &rarr; Subfamilia <b>Derivados</b> &rarr; artículos <b>Expeller de soja</b> y <b>Aceite de soja</b>.",
        "Categoría <b>Aditivos</b> &rarr; Familia <b>Minerales</b> &rarr; artículo <b>Carbonato de calcio</b>.",
    ]))
    E.append(Paragraph("<b>Comercio (repuestos / lubricantes):</b>", st_intro))
    E.append(bullets([
        "Categoría <b>Lubricantes</b> &rarr; Familia <b>Aceites de motor</b> &rarr; Subfamilia <b>15W40</b> &rarr; artículos <b>Aceite 15W40 x4 L</b> y <b>Aceite 15W40 x20 L</b>.",
        "Si comprás una unidad y después la vendés, es el <b>mismo artículo</b>: no crees uno para comprar y otro para vender.",
    ]))

    # PASO 2 articulo
    E.append(Paragraph("PASO 2 &nbsp;&mdash;&nbsp; Cargar un artículo (una sola vez)", st_h2))
    E.append(steps([
        "Entrá a <b>Catálogo de artículos</b> y tocá <b>+ Nuevo</b> en la categoría donde va, o usá el <b>+ Nuevo</b> de una pestaña y elegí la ubicación en el árbol.",
        "Completá <b>Nombre</b>, <b>Categoría/Familia</b> (del árbol) y <b>Unidad</b> (kg, L, tn, unidad, cabezas...).",
        "Marcá las <b>capacidades</b> (se pueden combinar): se compra, se vende, controla stock, se consume en producción, se obtiene por producción, es servicio.",
        "Opcional: SKU/código, código de barras, IVA por defecto, stock mínimo, precio de referencia y <b>presentación</b> (ej. unidad base kg + presentación bolsa de 20 kg).",
        "Guardá. Si ya existe un artículo con el mismo nombre en la misma ubicación, el sistema te avisa para que no dupliques.",
    ]))
    E.append(callout("<b>Capacidades combinables (lo más importante):</b> un mismo artículo puede hacer varias cosas. La <b>soja</b> se "
                     "<b>compra</b>, se <b>vende</b> y además se <b>consume en la molienda</b>; el <b>expeller</b> se <b>obtiene por producción</b> "
                     "y se <b>vende</b>. No hace falta crear dos artículos: marcás todas las capacidades que correspondan en la misma ficha.",
                     G100, G600, G900))
    E.append(callout("\U0001F4A1 Para cargar muchos artículos de una vez, usá la plantilla <b>Productos</b> en <b>Configuración &rarr; Importación</b>: "
                     "columnas <b>categoria*, familia, nombre*, unidad*, codigo, stockMinimo, precioReferencia, observaciones</b>. "
                     "La <b>familia</b> es el nombre exacto del árbol y el <b>codigo</b> queda como SKU del artículo.",
                     BLUE_BG, BLUE_BD, BLUE_TX))
    E.append(tabla([
        ["Artículo", "Capacidades típicas"],
        ["Soja en grano", "Se compra, se vende, controla stock, se consume en producción"],
        ["Expeller de soja", "Se obtiene por producción, se vende, controla stock"],
        ["Carbonato de calcio", "Se compra, controla stock, se consume en producción"],
        ["Aceite 15W40 x4 L", "Se compra, se vende, controla stock"],
        ["Flete / Labor a tercero", "Es servicio (no controla stock), se vende o se compra"],
    ], [50*mm, 115*mm]))

    # Molienda
    E.append(Paragraph("3 &nbsp;&mdash;&nbsp; Cómo se usa en la fórmula de molienda", st_h2))
    E.append(bullets([
        "La fórmula ofrece como <b>origen</b> los artículos marcados <b>&ldquo;se consume en producción&rdquo;</b> y como <b>coproducto</b> los marcados <b>&ldquo;se obtiene por producción&rdquo;</b>.",
        "Por eso, antes de armar una fórmula, asegurate de que la materia prima (soja) y los coproductos (expeller, aceite) tengan esas capacidades tildadas.",
        "La fórmula vincula artículos que ya existen: no crea artículos nuevos. El stock se mueve recién cuando confirmás un <b>Parte de molienda</b>.",
    ]))

    # Diagnostico
    E.append(Paragraph("PASO 3 (si venís de antes) &nbsp;&mdash;&nbsp; Diagnóstico y pasar lo viejo a artículos", st_h2))
    E.append(Paragraph(
        "Si en tu empresa quedaron cosas cargadas con el formato anterior (una lista vieja que no mueve stock), ordenalas así:", st_intro))
    E.append(steps([
        "En <b>Catálogo de artículos</b> tocá el botón <b>Diagnóstico de artículos</b>.",
        "Ves tres listas: ítems del formato viejo que deberían ser artículos, artículos sin clasificar en el árbol, y posibles duplicados por nombre.",
        "Con <b>Pasar a artículo</b> convertís los que elijas en artículos reales (comprables, vendibles, con stock). La ficha vieja queda inactiva y se puede recuperar: no se borra nada.",
        "Los <b>duplicados NO se fusionan solos</b>: revisalos vos y, si son el mismo producto físico, dejá uno y usá ese.",
    ]))
    E.append(callout("<b>Regla de oro:</b> <b>un artículo por producto físico</b>. No crees uno para comprar y otro para vender, ni uno "
                     "&ldquo;materia prima&rdquo; y otro &ldquo;producto&rdquo; del mismo grano. Un solo artículo con sus capacidades marcadas.",
                     AMBER_BG, AMBER_BD, AMBER_TX))

    # Unificar / mantenimiento del Stock
    E.append(Paragraph("UNA SOLA LISTA &nbsp;&mdash;&nbsp; Herramientas para dejar el Stock prolijo", st_h2))
    E.append(Paragraph(
        "Los insumos/cereales viven en <b>una sola lista</b> (la de Stock). Si venís de antes y ves duplicados, "
        "fantasmas o artículos que reaparecen, en la pantalla de <b>Stock</b> (como administrador) tenés cuatro botones:", st_intro))
    E.append(steps([
        "<b>Unificar artículos</b>: se corre <b>una vez por empresa</b>. Migra al Stock lo que faltaba del catálogo viejo "
        "(nombre, familia, precio) y quita del catálogo solo las filas de artículo de insumo/cereal (NO toca Labores, "
        "animales ni otros listados). Apaga la duplicación: nunca más reaparecen artículos borrados. Antes de aplicar, "
        "tené un <b>backup</b> reciente; el botón muestra un <b>preview</b> de lo que va a hacer. No se pierde ningún movimiento.",
        "<b>Fusionar artículos</b>: cuando el mismo producto quedó con <b>dos nombres distintos</b> (ej. &ldquo;2,4-D&rdquo; y "
        "&ldquo;2,4-D ETIL HEXIL&rdquo;), elegís cuál eliminar y cuál queda; el stock, los movimientos y las referencias pasan al que queda.",
        "<b>Recuperar artículos</b>: si te desapareció un insumo que sí usabas (ej. uno cargado desde una factura), lo vuelve a mostrar.",
        "<b>Depurar duplicados</b>: une los duplicados exactos (mismo nombre) conservando el que tiene stock y corrige las familias según el árbol.",
    ]))
    E.append(callout("<b>No se pierde nada:</b> ningún movimiento, factura ni labor apunta al catálogo viejo, por eso se puede "
                     "unificar sin riesgo para el historial. Igual, hacé el backup antes de aplicar.",
                     AMBER_BG, AMBER_BD, AMBER_TX))

    # Buscar
    E.append(Paragraph("4 &nbsp;&mdash;&nbsp; Encontrar un artículo", st_h2))
    E.append(bullets([
        "En <b>Catálogo de artículos</b>, arriba hay un <b>buscador global</b>: escribís el nombre (o código) y aparece el artículo <b>sin importar en qué subfamilia esté</b>.",
        "Cada artículo muestra su <b>ubicación completa</b> (ej. Agroindustria / Soja / Derivados) y unos <b>chips</b> con sus usos habilitados.",
    ]))

    # FAQ
    E.append(Paragraph("Preguntas frecuentes", st_h2))
    faqs = [
        ("Cargué un insumo y no aparece en stock ni en compras. ¿Qué pasó?",
         "Seguramente se cargó con el formato viejo (tabla de listas), no como artículo. Entrá a Catálogo de artículos -> Diagnóstico de artículos y usá Pasar a artículo."),
        ("¿Cuántos niveles de subfamilias puedo tener?",
         "Los que quieras. El árbol es ilimitado: Categoría -> Familia -> Subfamilia -> Subfamilia -> ... El número al lado de cada nodo cuenta sus artículos."),
        ("La misma soja la compro, la vendo y la muelo. ¿Creo tres artículos?",
         "No. Creás UN artículo y le marcás las tres capacidades: se compra, se vende y se consume en producción."),
        ("¿Qué diferencia hay entre 'controla stock' y 'es servicio'?",
         "Un artículo que controla stock suma y resta existencias (un insumo, un grano). Un servicio (flete, labor a tercero) no mueve stock: se factura pero no hay existencias."),
        ("¿Puedo tener dos artículos con el mismo nombre?",
         "En la misma categoría/familia no (el sistema avisa). En ramas distintas sí, aunque conviene evitarlo para no confundir."),
        ("Si muevo una familia a otra categoría, ¿pierdo los movimientos?",
         "No. Mover solo cambia dónde está ubicada. Los movimientos, saldos y precios siguen intactos porque apuntan al artículo, no a la carpeta."),
        ("Un artículo cuelga directo de una categoría, sin familia. ¿Está mal?",
         "No. Aparece agrupado como 'Directo en la categoría'. Es válido para comercios chicos que no necesitan familias."),
        ("¿Qué es la presentación (unidad base + presentación)?",
         "Sirve cuando controlás en una unidad pero comercializás en otra: ej. base kg y presentación bolsa de 20 kg. El sistema convierte bolsas <-> kg."),
    ]
    for q,a in faqs:
        E.append(Paragraph(q, st_faq_q)); E.append(Paragraph(a, st_faq_a))

    doc.build(E)
    print("PDF generado:", OUT)

if __name__ == "__main__":
    build()
