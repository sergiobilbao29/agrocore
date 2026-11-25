# -*- coding: utf-8 -*-
"""Instructivos nuevos, UNO POR TEMA (estilo AgroCore):
  - Instructivo-Campos-Compartidos.pdf      (grupo economico: campos y empleados)
  - Instructivo-Carga-Varios-Lotes.pdf      (insumos/labores en varios lotes)
  - Instructivo-Importar-Cheques-PDF.pdf    (e-cheques desde el PDF del homebanking)
  - Instructivo-Sueldos-Transferencia.pdf   (pago por transferencia + detalle/recibo)
"""
import os
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import (BaseDocTemplate, PageTemplate, Frame, Paragraph,
                                Table, TableStyle, ListFlowable, ListItem)

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUTDIR = os.path.join(BASE, "Instructivos")
LOGO = os.path.join(BASE, "..", "web", "img", "logo-full-256.png")

G900 = colors.HexColor("#14532d"); G700 = colors.HexColor("#15803d")
G600 = colors.HexColor("#16a34a"); G100 = colors.HexColor("#dcfce7")
AMBER_BG = colors.HexColor("#fef3c7"); AMBER_BD = colors.HexColor("#f59e0b"); AMBER_TX = colors.HexColor("#92400e")
BLUE_BG = colors.HexColor("#e0f2fe"); BLUE_BD = colors.HexColor("#38bdf8"); BLUE_TX = colors.HexColor("#075985")
SLATE = colors.HexColor("#475569")

styles = getSampleStyleSheet()
def S(name, **kw): return ParagraphStyle(name, parent=styles["Normal"], **kw)
st_title = S("t", fontName="Helvetica-Bold", fontSize=20, textColor=G900, spaceAfter=2, leading=24)
st_sub   = S("s", fontName="Helvetica", fontSize=11, textColor=SLATE, spaceAfter=10, leading=15)
st_intro = S("i", fontName="Helvetica", fontSize=10.5, textColor=colors.HexColor("#1f2937"), leading=16, spaceAfter=6)
st_h2    = S("h2", fontName="Helvetica-Bold", fontSize=13, textColor=G700, spaceBefore=12, spaceAfter=6, leading=17)
st_h3    = S("h3", fontName="Helvetica-Bold", fontSize=11.5, textColor=G900, spaceBefore=8, spaceAfter=3, leading=15)
st_step  = S("step", fontName="Helvetica", fontSize=10.5, textColor=colors.HexColor("#111827"), leading=16)
st_faq_q = S("faqq", fontName="Helvetica-Bold", fontSize=10.5, textColor=G900, leading=15, spaceBefore=6)
st_faq_a = S("faqa", fontName="Helvetica", fontSize=10.5, textColor=colors.HexColor("#1f2937"), leading=15)

KIND = {"g": (G100, G600, G900), "a": (AMBER_BG, AMBER_BD, AMBER_TX), "b": (BLUE_BG, BLUE_BD, BLUE_TX)}

def callout(text, kind="g"):
    bg, bd, tx = KIND[kind]
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

def build(filename, title, subtitle, blocks):
    out = os.path.join(OUTDIR, filename)
    doc = BaseDocTemplate(out, pagesize=A4, leftMargin=15*mm, rightMargin=15*mm, topMargin=30*mm, bottomMargin=20*mm)
    frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id='f')
    doc.addPageTemplates([PageTemplate(id='main', frames=[frame], onPage=header_footer)])
    E = [Paragraph(title, st_title), Paragraph(subtitle, st_sub)]
    for kind, val in blocks:
        if kind == "intro":   E.append(Paragraph(val, st_intro))
        elif kind == "h2":    E.append(Paragraph(val, st_h2))
        elif kind == "h3":    E.append(Paragraph(val, st_h3))
        elif kind == "steps": E.append(steps(val))
        elif kind == "bullets": E.append(bullets(val))
        elif kind == "call":  E.append(callout(val[0], val[1]))
        elif kind == "faq":
            E.append(Paragraph("Preguntas frecuentes", st_h2))
            for q, a in val:
                E.append(Paragraph(q, st_faq_q)); E.append(Paragraph(a, st_faq_a))
    doc.build(E)
    print("PDF generado:", out)

# ============================================================
# 1) CAMPOS Y EMPLEADOS COMPARTIDOS (grupo economico)
# ============================================================
build("Instructivo-Campos-Compartidos.pdf",
  "Compartir campos (y empleados) con el grupo económico",
  "Cargar un campo o un empleado UNA sola vez y usarlo en todas tus empresas",
  [
    ("intro", "Si trabajás con varias empresas del mismo grupo, podés cargar un <b>campo</b> o un <b>empleado</b> una sola vez "
              "y verlo/usarlo en todas, sin recargarlo en cada una. Esta guía explica cómo."),
    ("h2", "Compartir un CAMPO"),
    ("steps", [
        "Entrá a <b>Producción &rarr; Campos</b> y abrí la ficha del campo (o creá uno nuevo con <b>+ Nuevo campo</b>).",
        "Bajá hasta la sección <b>\U0001F310 Grupo económico</b> y tildá <b>“Compartir con el grupo”</b>.",
        "Guardá. El campo y <b>todos sus lotes</b> quedan visibles en <b>todas tus empresas</b>.",
        "En cada empresa, al crear una campaña, vas a poder elegir ese campo/lote y las hectáreas que sembrás esa temporada.",
    ]),
    ("call", ("<b>Clave:</b> el campo/lote es solo el <b>lugar físico</b>. Cada <b>campaña</b> sigue siendo de la empresa que la "
              "siembra ese año (no cambia la titularidad fiscal de nada). Así un año lo usa una empresa y otro año otra, y se "
              "mantiene la <b>comparación año a año</b> del campo.", "g")),
    ("call", ("Los campos de <b>otra empresa</b> del grupo aparecen con el cartel <b>\U0001F310 Compartido</b> (y “de [empresa]”). "
              "Solo los puede <b>editar/borrar su dueño</b>; las demás empresas los <b>usan</b> (cargan campañas, labores, insumos) "
              "pero no los modifican. Cualquiera del grupo puede agregar o ajustar <b>lotes</b>.", "b")),
    ("h2", "Compartir un EMPLEADO"),
    ("steps", [
        "Entrá a <b>Administración &rarr; Empleados</b> y abrí la ficha del empleado.",
        "Tildá <b>“Compartir con el grupo”</b> y guardá.",
        "Queda dado de alta en una sola empresa, pero lo <b>ves y usás en todas</b> (labores, planillas de sueldo, etc.).",
    ]),
    ("call", ("Lo que tiene <b>contrato propio</b> de una empresa (ej. un <b>arrendamiento</b>) va a nombre de esa empresa y <b>no</b> se "
              "comparte. Compartir es para lo que usa todo el grupo (el campo físico, el jornalero que trabaja para todas).", "a")),
    ("faq", [
        ("Compartí un campo pero no lo veo en la otra empresa.",
         "Cambiá de empresa con el selector de arriba a la izquierda y mirá Producción -> Campos: aparece con el cartel Compartido. También sale en el selector de campaña/lote."),
        ("Si lo comparto, ¿pierdo la info del campo en mi empresa?",
         "No. No se mueve ni se duplica nada: el mismo campo pasa a estar visible para todo el grupo. Lo seguís editando desde la empresa dueña."),
        ("¿Puedo dejar de compartirlo?",
         "Sí: desde la ficha del campo (en la empresa dueña) destildá 'Compartir con el grupo' y guardá."),
    ]),
  ])

# ============================================================
# 2) CARGAR INSUMOS / LABORES EN VARIOS LOTES
# ============================================================
build("Instructivo-Carga-Varios-Lotes.pdf",
  "Cargar un insumo o una labor en VARIOS lotes a la vez",
  "Para lotes que se hacen exactamente igual, cargalo una vez y replicalo",
  [
    ("intro", "Cuando varios lotes (del mismo campo o de campos pegados) se hacen <b>igual</b>, no hace falta cargarlos uno por uno. "
              "Lo cargás una vez y lo aplicás a todos. Cada lote usa <b>sus</b> hectáreas y descuenta <b>su</b> stock."),
    ("h2", "Insumos en varios lotes"),
    ("steps", [
        "En <b>Producción &rarr; Insumos y labores</b>, tocá <b>+ Insumo</b>.",
        "Elegí la <b>campaña/lote</b> principal, la <b>fecha</b> y la <b>moneda</b> de los costos.",
        "Cargá los insumos (tipo, producto, dosis/ha, costo).",
        "Abrí el desplegable <b>“➕ Aplicar también a otras campañas / lotes”</b> y <b>tildá</b> las campañas donde se hizo lo mismo.",
        "Guardá: los <b>mismos insumos</b> se cargan en cada campaña tildada, usando las <b>hectáreas del lote de cada una</b>.",
    ]),
    ("h2", "La misma labor en varios lotes"),
    ("steps", [
        "Tocá <b>+ Labor</b> y cargá la labor (tipo, fecha, precio/ha, moneda, empleados e insumos si corresponde).",
        "Abrí <b>“➕ Cargar esta misma labor en otras campañas / lotes”</b> y <b>tildá</b> las campañas.",
        "Guardá: la <b>misma labor</b> (con sus insumos y empleados) se carga en cada una, con las hectáreas del lote de cada campaña. Los insumos <b>escalan solos</b> a esas hectáreas.",
    ]),
    ("call", ("Es <b>opcional</b>: si no abrís el desplegable, la carga funciona igual que siempre (una sola campaña). "
              "En labores <b>no aplica</b> a servicios a terceros ni cuando estás <b>editando</b> una labor existente.", "a")),
    ("call", ("<b>Tip:</b> si un lote se hizo otro día, cargalos todos juntos igual y después ajustá la <b>fecha</b> del que difiera "
              "desde su propio renglón en la lista de insumos/labores.", "b")),
    ("faq", [
        ("Las hectáreas me quedaron distintas en cada lote.",
         "Es correcto: cada campaña usa las hectáreas de SU lote. Los insumos escalan solos a esas hectáreas."),
        ("¿Puedo elegir lotes de otra empresa del grupo?",
         "Sí, si el campo está compartido (ver el instructivo de Campos compartidos). Cada campaña sigue siendo de su empresa."),
        ("¿Descuenta el stock dos veces?",
         "No: descuenta una vez por cada campaña/lote (lo que realmente se usó en cada uno)."),
    ]),
  ])

# ============================================================
# 3) IMPORTAR E-CHEQUES DESDE PDF
# ============================================================
build("Instructivo-Importar-Cheques-PDF.pdf",
  "Importar e-cheques desde el PDF del homebanking",
  "Subí el PDF del banco y el sistema carga el cheque solo",
  [
    ("intro", "Para no cargar los e-cheques a mano, podés subir el <b>PDF</b> que te da el banco (Galicia y similares) y el sistema "
              "lee los datos automáticamente."),
    ("h2", "Paso a paso"),
    ("steps", [
        "En <b>Tesorería &rarr; Cheques</b>, tocá <b>\U0001F4C4 Importar PDF</b>.",
        "Elegí <b>uno o varios</b> PDF del e-cheque (el “Detalle de cheque electrónico” que baja del homebanking).",
        "El sistema lee <b>N°, importe, banco, fechas, beneficiario/librador, CUIT y motivo</b>, y detecta si es <b>propio</b> (lo emitiste vos) o <b>de terceros</b> (lo recibiste).",
        "Si es <b>uno</b>: te abre el cheque <b>prellenado</b> para revisar y <b>Guardar</b>. Si son <b>varios</b>: muestra la lista para confirmar y <b>Guardar seleccionados</b>.",
    ]),
    ("call", ("Avisa si un cheque <b>ya está cargado</b> (por su N°): esos vienen <b>destildados</b> para no duplicar. "
              "El PDF tiene que ser el <b>original del homebanking</b> (no una foto ni un escaneo).", "b")),
    ("call", ("<b>Recordá:</b> la pantalla de Cheques arranca mostrando solo los <b>“En cartera”</b>. Para ver los <b>emitidos</b>, "
              "<b>depositados</b> o <b>transferidos</b>, poné el filtro <b>Estado &rarr; Todos</b>. Los cheques nunca se pierden: están en otro estado.", "a")),
    ("faq", [
        ("No reconoce el PDF.",
         "Tiene que ser el PDF original del homebanking (Detalle de cheque electrónico). Si es una foto o escaneo, cargalo a mano con + Nuevo."),
        ("Cargué un cheque pero no lo veo en la lista.",
         "Poné el filtro Estado -> Todos. Los e-cheques emitidos no aparecen con el filtro 'En cartera'."),
        ("¿Puedo importar los de varios bancos?",
         "Sí, mientras sea el PDF de 'detalle de cheque' del homebanking. El sistema normaliza el banco (Galicia, Macro, BBVA, Santander, etc.)."),
    ]),
  ])

# ============================================================
# 4) SUELDOS POR TRANSFERENCIA + DETALLE / RECIBO
# ============================================================
build("Instructivo-Sueldos-Transferencia.pdf",
  "Sueldos: pago por transferencia, detalle y recibo",
  "Que el pago impacte en el banco, y ver/imprimir el recibo de cada liquidación",
  [
    ("intro", "Al liquidar un sueldo por <b>transferencia</b> ahora se refleja en el banco; y cada liquidación tiene su <b>detalle</b> "
              "(cómo se compone) y su <b>recibo imprimible</b>."),
    ("h2", "Pagar un sueldo por transferencia"),
    ("steps", [
        "En la ficha del empleado, tocá <b>Liquidar / Registrar pago</b> del mes.",
        "Elegí medio de pago <b>Transferencia</b> y la <b>cuenta bancaria</b> real de la que sale la plata.",
        "Guardá: se genera el <b>egreso en Bancos</b> de esa cuenta (antes quedaba solo registrado). También vale para el pago <b>combinado</b> (una parte por transferencia).",
    ]),
    ("h2", "Ver el detalle y el recibo"),
    ("steps", [
        "En la ficha del empleado, mirá el <b>Historial de liquidaciones</b>.",
        "Tocá <b>\U0001F441 Detalle</b> para ver cómo se compone: ganancias, gastos/adelantos, neto del mes, el <b>saldo del mes anterior</b> y el total a pagar.",
        "Tocá <b>\U0001F9FE Recibo</b> para <b>imprimir</b> o guardar en PDF el recibo de pago (con encabezado de la empresa, datos del empleado, el desglose y las firmas).",
    ]),
    ("call", ("<b>Cuidado con los adelantos:</b> la plata que ya le diste <b>antes</b> va como <b>adelanto</b> (gasto); lo que pagás al "
              "liquidar es el <b>pago</b>. La misma plata se carga <b>una sola vez</b> (o como adelanto, o como pago), nunca las dos, "
              "si no el saldo da mal.", "a")),
    ("call", ("El <b>saldo pasa solo</b> de un mes al siguiente (cuenta corriente con arrastre). Si un mes le pagaste de más o de menos, "
              "la diferencia aparece como <b>saldo a favor</b> o <b>en contra</b> en el mes que sigue.", "b")),
    ("faq", [
        ("Pagué por transferencia y no lo veo en el banco.",
         "Al liquidar tenés que elegir la cuenta bancaria. Si una liquidación vieja no lo reflejó, anulala y volvela a hacer eligiendo la cuenta."),
        ("El detalle me dice que el empleado debe, y no debería.",
         "Suele ser que la misma plata está cargada dos veces (como adelanto Y como pago). Dejala una sola vez. Revisá también el saldo del mes anterior en el Detalle."),
        ("¿Puedo reimprimir un recibo viejo?",
         "Sí: en el Historial de liquidaciones, botón Recibo del mes que quieras."),
    ]),
  ])
