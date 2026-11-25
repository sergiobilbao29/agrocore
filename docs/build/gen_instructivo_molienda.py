# -*- coding: utf-8 -*-
"""Instructivo: Molienda / Fabrica + Plan canje (PDF, estilo AgroCore)."""
import os
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import (BaseDocTemplate, PageTemplate, Frame, Paragraph,
                                Spacer, Table, TableStyle, ListFlowable, ListItem)

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(BASE, "Instructivos", "Instructivo-Molienda-Fabrica.pdf")
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
    E.append(Paragraph("Molienda / Fábrica", st_title))
    E.append(Paragraph("Procesar un grano (ej. soja) y que el stock de los coproductos se arme solo, con el costo de fabricación y el precio de venta", st_sub))
    E.append(Paragraph(
        "El módulo <b>Molienda / Fábrica</b> es para plantas que transforman un grano en varios productos (expeller de "
        "soja, aceite, etc.). Cada jornada cargás una <b>planilla de producción diaria</b>: las <b>materias primas</b> "
        "realmente consumidas (soja, un poco de maní, carbonato) con sus <b>kilos reales</b>, y los <b>productos "
        "obtenidos</b> reales (expeller, aceite, desperdicio), más la <b>merma de secado</b> aparte. El sistema "
        "<b>descuenta cada materia prima e ingresa cada producto</b> en el stock, calcula el <b>costo de fabricación por "
        "kilo</b> y, con un <b>% de ganancia</b>, te sugiere el precio de venta. Está en <b>Stock y depósitos &rarr; "
        "Molienda / Fábrica</b>.", st_intro))
    E.append(callout("<b>El circuito en una línea:</b> &nbsp; Cargás los kg reales de cada materia prima &rarr; el sistema "
                     "descuenta las materias primas e ingresa expeller + aceite + (merma/desperdicio) &rarr; obtenés "
                     "costo por kg, valor de venta y precio sugerido.", G100, G600, G900))
    E.append(callout("<b>Ejemplo:</b> entran <b>30.000 kg</b> de soja (88% expeller, 10% aceite, 2% merma) &rarr; quedan "
                     "<b>26.400 kg</b> de expeller, <b>3.000 kg</b> de aceite y <b>600 kg</b> de merma. Todo automático.", BLUE_BG, BLUE_BD, BLUE_TX))
    E.append(Spacer(1, 3))

    E.append(Paragraph("PASO 0 &nbsp;&mdash;&nbsp; Activar el módulo en la empresa (una sola vez)", st_h2))
    E.append(steps([
        "El módulo es <b>opcional por empresa</b>: solo lo ven las que fabrican. Andá a <b>Configuración &rarr; "
        "Empresa</b> y editá la empresa procesadora.",
        "Tildá <b>&ldquo;Producción industrial / Fábrica&rdquo;</b> y guardá. Recién ahí aparece <b>Molienda / "
        "Fábrica</b> dentro de <b>Stock y depósitos</b>.",
    ]))
    E.append(callout("<b>Por qué es opcional:</b> AgroCore es multi-empresa. Si una sola de tus empresas muele o fabrica, "
                     "activás el módulo solo en esa y las demás no se llenan de menús que no usan.", AMBER_BG, AMBER_BD, AMBER_TX))

    E.append(Paragraph("PASO 1 &nbsp;&mdash;&nbsp; Crear los artículos y los depósitos (una sola vez)", st_h2))
    E.append(steps([
        "En <b>Stock</b>, creá los artículos que vas a usar: la <b>Soja</b> (grano de origen) y los coproductos "
        "<b>Expeller de soja</b>, <b>Aceite de soja</b> y <b>Merma</b>. Usá la unidad <b>kg</b> en todos.",
        "En <b>Stock y depósitos &rarr; Depósitos y cerealeras</b>, creá (si querés separarlos) el <b>silo de soja</b>, "
        "el <b>depósito de expeller</b>, el <b>tanque de aceite</b> y un <b>depósito de mermas</b>. Es opcional: si no "
        "elegís depósito, va al general.",
        "Asegurate de que la <b>soja tenga cargado su costo</b> (entra solo con la compra, o lo podés poner a mano al "
        "cargar el parte).",
    ]))

    E.append(Paragraph("PASO 2 &nbsp;&mdash;&nbsp; Definir la fórmula de molienda (una sola vez)", st_h2))
    E.append(steps([
        "Andá a <b>Stock y depósitos &rarr; Molienda / Fábrica</b> y abrí la pestaña <b>&#9881;&#65039; Fórmulas</b>.",
        "Toca <b>&#65291; Nueva fórmula</b>. Poné un <b>nombre</b> (ej. &ldquo;Molienda de soja&rdquo;) y elegí el "
        "<b>grano de origen</b> (Soja).",
        "Agregá un renglón por cada <b>coproducto</b>: elegí el producto, su <b>% de rendimiento</b> (Expeller 88, "
        "Aceite 10, Merma 2) y, si querés, el <b>depósito destino</b>. Tildá <b>merma</b> en el renglón de la merma "
        "(la merma no lleva costo).",
        "Los <b>% deben sumar 100</b>. Abajo vas viendo la suma. Toca <b>Guardar</b>.",
    ]))
    E.append(callout("<b>Coeficiente de costo (opcional):</b> por defecto el costo se reparte igual que el rendimiento. "
                     "Si querés que el aceite &ldquo;cargue&rdquo; más costo que el expeller (porque vale más), podés "
                     "poner un coeficiente distinto en cada renglón. Si no lo tocás, funciona bien igual.", AMBER_BG, AMBER_BD, AMBER_TX))

    E.append(Paragraph("PASO 3 &nbsp;&mdash;&nbsp; Cargar la planilla de producción del día (cada jornada)", st_h2))
    E.append(steps([
        "En <b>Molienda / Fábrica &rarr; &#127981; Partes de molienda</b>, toca <b>&#65291; Nuevo parte de producción</b>.",
        "Elegí la <b>fórmula</b> (precarga las materias primas y los productos) y la <b>fecha de jornada</b>. Poné la "
        "<b>hora de inicio y fin</b> (ej. 23:00 &rarr; 17:00) como dato.",
        "<b>Materias primas consumidas:</b> en la grilla cargá los <b>kilos reales</b> de cada una (soja, un poco de "
        "maní, carbonato), con su <b>$/kg</b> (viene prellenado) y el <b>depósito</b> de donde sale. Agregá o quita "
        "filas con <b>&#65291; Materia prima</b>.",
        "<b>Productos obtenidos:</b> cargá los <b>kilos reales</b> de expeller, aceite y desperdicio, con su "
        "<b>depósito destino</b>. Tildá <b>Merma</b> en el desperdicio/merma (no ingresa stock ni lleva costo).",
        "Cargá aparte la <b>Merma de secado</b> (desactivación de la soja).",
        "<b>Costos indirectos del lote (individualizados):</b> en la grilla cargá por separado la <b>luz</b>, el <b>gasoil "
        "de la secadora</b>, el <b>personal</b>, el <b>mantenimiento</b>, etc. La <b>suma</b> es el costo de producción del "
        "lote y se reparte entre los productos. Si el gasto es mensual (ej. la factura de luz), poné en cada jornada la "
        "parte que corresponde (mensual &divide; jornadas del mes).",
        "Mirá el <b>balance en vivo</b>: procesado vs. obtenido vs. merma, el <b>costo por kg</b> de cada producto y, si "
        "el producto tiene precio de referencia, el <b>valor de venta</b>. Si está todo bien, toca <b>Registrar "
        "producción</b>: el sistema descuenta cada materia prima e ingresa cada producto. Lo ves al toque en <b>Stock</b>.",
    ]))
    E.append(callout("<b>&#128424;&#65039; Planilla en blanco para el operario:</b> antes de arrancar la producción, toca "
                     "<b>Imprimir planilla en blanco</b>. Sale una hoja con las materias primas, el secado y los "
                     "productos para que el operario anote a mano los kilos durante la jornada, y después los carga al "
                     "sistema. Los kilos nunca son exactos: cargá siempre los reales.", G100, G600, G900))
    E.append(callout("<b>Control de stock:</b> el sistema <b>no te deja procesar más grano del que hay</b> en el silo "
                     "elegido. Si intentás moler más de lo disponible, te avisa cuánto hay y no registra el parte "
                     "(así no queda stock negativo).", AMBER_BG, AMBER_BD, AMBER_TX))
    E.append(callout("<b>¿Te equivocaste?</b> En la lista de partes, el botón <b>Anular</b> revierte todo: vuelve la soja "
                     "al silo y saca los coproductos. Después lo volvés a cargar bien.", BLUE_BG, BLUE_BD, BLUE_TX))

    E.append(Paragraph("PASO 4 &nbsp;&mdash;&nbsp; Costo de fabricación y precio de venta", st_h2))
    E.append(steps([
        "Abrí la pestaña <b>&#127991;&#65039; Costo y precio</b>. Vas a ver cada coproducto con su <b>costo de "
        "fabricación por kg</b> (lo calculó el último parte de molienda).",
        "En cada uno, cargá el <b>% de ganancia</b> que querés y toca <b>Guardar</b>.",
        "El sistema te muestra el <b>precio de venta sugerido por kg</b> (costo x (1 + %)) y lo guarda como precio de "
        "referencia del artículo, listo para usar al vender.",
    ]))

    E.append(Paragraph("PASO 5 &nbsp;&mdash;&nbsp; Plan canje (entregar producto y recibir grano, o al revés)", st_h2))
    E.append(Paragraph(
        "El <b>plan canje</b> sirve cuando entregás un producto (expeller/aceite) y cobrás en <b>grano</b> (soja), o "
        "cuando comprás soja y pagás con producto. Se maneja por <b>paridad</b> (una relación fija) y es en especie "
        "(kilos): mueve el stock, no toca las cuentas en pesos. Está en la pestaña <b>&#128257; Plan canje</b>.", st_intro))
    E.append(steps([
        "Primero creá una <b>paridad</b> (abajo de la pantalla, <b>&#65291; Paridad</b>): elegí qué <b>entregás</b>, qué "
        "<b>recibís</b> y la <b>relación</b> (cuántos kg recibís por 1 kg que entregás, ej. 1 : 1,2).",
        "Toca <b>&#65291; Nueva operación de canje</b>. Elegí el <b>tipo</b>: <b>Venta</b> (entregás producto, cobrás en "
        "grano) o <b>Compra</b> (recibís grano, pagás con producto), y la <b>contraparte</b> (cliente o proveedor).",
        "Elegí la <b>paridad</b> (completa las cantidades sola) o cargalas a mano. Revisá que entre en el depósito "
        "correcto y toca <b>Registrar canje</b>.",
        "El stock se ajusta solo: <b>sale</b> lo que entregaste y <b>entra</b> lo que recibiste. También se puede "
        "<b>Anular</b> (revierte el stock).",
    ]))

    E.append(Paragraph("PASO 6 &nbsp;&mdash;&nbsp; Cuentas de Fábrica (ficha 360 del contacto)", st_h2))
    E.append(Paragraph(
        "Un mismo contacto puede ser a la vez <b>proveedor de grano</b> (te vende soja), <b>cliente de subproducto</b> "
        "(te compra expeller/aceite) y <b>canjeador</b> (te deja grano y se lleva producto). La <b>ficha 360</b> junta "
        "todo eso en una sola pantalla. Está en <b>Fábrica &rarr; Cuentas de Fábrica (360)</b>.", st_intro))
    E.append(steps([
        "En la lista ves, por contacto: el <b>neto en pesos</b> (lo que te debe como cliente de subproducto MENOS lo que "
        "le debes como proveedor de grano) y el <b>saldo en kilos</b> (canje en especie + grano pendiente de liquidar), "
        "valorizado a la <b>pizarra de soja del día</b>.",
        "Toca <b>Ver ficha 360</b> y se abre el detalle: en <b>pesos</b> (te debe / le debes / neto) y en <b>kilos</b> "
        "(canje / grano pendiente / total), cada kilo con su equivalente en pesos.",
        "Desde la ficha tenés accesos directos a <b>Canje</b>, <b>Granos</b>, <b>A cobrar</b> y <b>A pagar</b> para cargar "
        "cada movimiento donde corresponde.",
    ]))
    E.append(callout("<b>Cómo sabe que es el mismo contacto:</b> agrupa por el <b>vínculo cliente&harr;proveedor</b> (el de "
                     "Compensación de cuentas). Si un contacto todavía no está vinculado, la ficha te avisa y te ofrece "
                     "<b>vincularlo</b> para que el neto quede completo.", G100, G600, G900))
    E.append(callout("<b>Dónde está todo:</b> Molienda/Fábrica, Plan canje, Cuenta canje, Proveedores de granos y Cuentas "
                     "de Fábrica (360) están juntos en la sección <b>Fábrica</b> del menú, visible solo en empresas con "
                     "<b>Producción industrial</b> activada.", BLUE_BG, BLUE_BD, BLUE_TX))

    E.append(Paragraph("Preguntas frecuentes", st_h2))
    faqs = [
        ("¿Puedo cargar varias materias primas con kilos distintos cada día?",
         "Sí. La planilla trae una grilla de materias primas: cargás los kilos reales de la soja, el maní y el carbonato (o lo que uses) de esa jornada. La fórmula las precarga, pero vos editás los kilos reales, que siempre varían un poco."),
        ("¿La merma de secado va junto con la merma de molienda?",
         "No. El secado/desactivación se carga en su propio campo 'Merma de secado', aparte de la merma/desperdicio de la molienda, para que el rendimiento real quede claro."),
        ("¿Puedo imprimir una planilla para que el operario la complete a mano?",
         "Sí. En el parte de producción toca 'Imprimir planilla en blanco': sale una hoja con materias primas, secado y productos obtenidos para anotar los kilos en la planta y después cargarlos al sistema."),
        ("¿Tengo que calcular yo los kilos de expeller y aceite?",
         "No para el costo: vos cargás los kilos reales que salieron de cada producto y el sistema reparte el costo del lote y calcula el costo por kg. Los kilos reales los anota el operario (nunca son exactos)."),
        ("¿De dónde sale el costo de fabricación por kilo?",
         "Del costo de la soja consumida más los costos de producción que cargaste en el parte. Ese total se reparte entre los coproductos (por defecto según el rendimiento) y se divide por los kilos de cada uno."),
        ("¿La merma lleva costo?",
         "No. La merma se contabiliza en kilos (para que el stock cierre) pero no se le asigna costo: el costo se reparte entre los productos aprovechables (expeller y aceite)."),
        ("Cambié el % de ganancia, ¿se actualiza el precio?",
         "Sí. Al guardar en 'Costo y precio', se recalcula el precio sugerido y se guarda como precio de referencia del artículo."),
        ("El canje, ¿genera deuda en pesos?",
         "No. El canje es en especie: mueve kilos de un producto por kilos de otro según la paridad. No registra importes en la cuenta corriente."),
        ("¿Puedo moler distintos granos o recetas?",
         "Sí. Creá una fórmula por cada receta (cada grano de origen con sus coproductos y porcentajes) y al cargar el parte elegís cuál usar."),
        ("Un cliente me compra expeller, me vende soja y además canjea. ¿Puedo ver todo junto?",
         "Sí. En Fábrica -> Cuentas de Fábrica (360) tenés la ficha unificada del contacto: el neto en pesos (cliente de subproducto menos proveedor de grano) y el saldo en kilos (canje + grano pendiente), valorizado a la soja del día. Agrupa por el vínculo cliente<->proveedor; si no está vinculado, te ofrece vincularlo."),
        ("No veo el módulo Molienda / Fábrica en el menú, ¿por qué?",
         "Porque es opcional por empresa. Andá a Configuración -> Empresa, editá la empresa y tildá 'Producción industrial / Fábrica'. Recién ahí aparece la sección 'Fábrica' en el menú (con Molienda, Plan canje, Cuenta canje, Proveedores de granos y Cuentas 360). Es a propósito: las empresas que no fabrican no lo necesitan."),
        ("¿Qué pasa si lo que salió no coincide con la fórmula?",
         "Tildás 'Cargar rendimiento real' en el parte y cargás los kg que de verdad salieron de cada coproducto. La merma se recalcula sola como lo que falte y el costo por kg se ajusta a la producción real."),
        ("Quise moler más kilos de los que tengo y no me dejó.",
         "Es correcto: el sistema controla el stock para no quedar en negativo. Fijate cuánta soja hay en ese silo (o elegí el silo correcto) y cargalo con una cantidad que no supere lo disponible."),
    ]
    for q,a in faqs:
        E.append(Paragraph(q, st_faq_q)); E.append(Paragraph(a, st_faq_a))

    doc.build(E)
    print("PDF generado:", OUT)

if __name__ == "__main__":
    build()
