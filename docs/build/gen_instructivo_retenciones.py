# -*- coding: utf-8 -*-
"""Instructivo paso a paso: Retenciones y percepciones (configuración y uso)."""
import os
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import (BaseDocTemplate, PageTemplate, Frame, Paragraph,
                                Spacer, Table, TableStyle, ListFlowable, ListItem)

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(BASE, "Instructivos", "Instructivo-Retenciones-y-Percepciones.pdf")
LOGO = os.path.join(BASE, "..", "web", "img", "logo-full-256.png")

G900 = colors.HexColor("#14532d"); G700 = colors.HexColor("#15803d")
G600 = colors.HexColor("#16a34a"); G100 = colors.HexColor("#dcfce7")
AMBER_BG = colors.HexColor("#fef3c7"); AMBER_BD = colors.HexColor("#f59e0b"); AMBER_TX = colors.HexColor("#92400e")
BLUE_BG = colors.HexColor("#e0f2fe"); BLUE_BD = colors.HexColor("#38bdf8"); BLUE_TX = colors.HexColor("#075985")
INDIGO_BG = colors.HexColor("#eef2ff"); INDIGO_BD = colors.HexColor("#818cf8"); INDIGO_TX = colors.HexColor("#3730a3")
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
    canvas.drawString(15*mm, 10*mm, "AgroCore - El corazon del negocio agricola")
    canvas.drawRightString(w-15*mm, 10*mm, "Pagina %d" % doc.page)
    canvas.restoreState()

def build():
    doc = BaseDocTemplate(OUT, pagesize=A4, leftMargin=15*mm, rightMargin=15*mm, topMargin=30*mm, bottomMargin=20*mm)
    frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id='f')
    doc.addPageTemplates([PageTemplate(id='main', frames=[frame], onPage=header_footer)])
    E = []
    E.append(Paragraph("Retenciones y percepciones", st_title))
    E.append(Paragraph("Configuración y uso paso a paso: al pagar, al cobrar, liquidar al fisco, créditos fiscales y presentación", st_sub))
    E.append(Paragraph(
        "AgroCore maneja las <b>retenciones</b> y <b>percepciones</b> de punta a punta: las que <b>le hacés a un proveedor</b> "
        "cuando le pagás (<b>practicadas</b>) y las que <b>te hacen a vos</b> cuando te cobran (<b>sufridas</b>). Todo queda "
        "integrado con la cuenta corriente y el banco, y listo para presentar en ARCA / IIBB.", st_intro))
    E.append(callout("<b>Regla de oro:</b> la retención <b>no es un descuento comercial</b>. La deuda/factura se cancela por su "
                     "<b>total</b>; lo retenido simplemente <b>no mueve el banco</b> y queda registrado aparte (como obligación "
                     "a depositar, si es practicada; o como crédito fiscal, si es sufrida).", G100, G600, G900))

    # ---- PARTE 1: Configuración ----
    E.append(Paragraph("PARTE 1 — Configuración (una vez)", st_h2))
    E.append(Paragraph("<b>a) Catálogo de regímenes</b> — tus retenciones reutilizables, para no tipearlas cada vez.", st_intro))
    E.append(steps([
        "Entrá a <b>Tesorería → Retenciones</b> y tocá <b>⚙️ Regímenes</b>.",
        "Tocá <b>+ Nuevo régimen</b> (o <b>Cargar ejemplos</b> para arrancar con algunos típicos y después editarlos).",
        "Completá: <b>nombre</b> (ej. “Ganancias RG 830 – Bienes”), <b>tipo</b> (practicada/sufrida), <b>impuesto</b>, "
        "<b>jurisdicción</b> si es IIBB, <b>base</b> (neto o total), <b>alícuota</b> (y la de “no inscripto” si aplica), "
        "<b>mínimo no sujeto</b>, <b>mínimo de retención</b> y el <b>sistema</b> (SICORE/SIRE/SIRCAR).",
        "Guardá. Revisá que las alícuotas y mínimos estén <b>al día con la normativa</b> (eso lo definís con tu contador).",
    ]))
    E.append(Paragraph("<b>b) Datos fiscales del cliente/proveedor</b> — para que el cálculo salga bien.", st_intro))
    E.append(steps([
        "Abrí la ficha del <b>cliente</b> o <b>proveedor</b> y desplegá <b>🧾 Datos fiscales para retenciones</b>.",
        "Cargá la <b>condición frente a Ganancias</b> (inscripto / no inscripto / exento).",
        "Si tiene <b>certificado de exclusión</b>, cargá el <b>impuesto</b>, el <b>%</b>, la <b>vigencia</b> (desde/hasta) y el "
        "<b>N° de certificado</b>. Cuando esté vigente, el sistema <b>avisa y reduce la retención sola</b>.",
    ]))
    E.append(callout("Las condiciones fiscales <b>no se adivinan por el nombre</b> del cliente/proveedor: cargalas vos para que "
                     "el motor calcule correctamente.", BLUE_BG, BLUE_BD, BLUE_TX))

    # ---- PARTE 2: Al pagar (practicadas) ----
    E.append(Paragraph("PARTE 2 — Retención PRACTICADA (al pagar a un proveedor)", st_h2))
    E.append(steps([
        "En el <b>pago al proveedor</b>, tildá la(s) factura(s) y, en la sección <b>🧾 Retenciones practicadas</b>, tocá <b>+ Agregar</b>.",
        "Elegí el <b>régimen</b> del catálogo: el sistema <b>propone el importe</b> (base × alícuota) respetando el mínimo. "
        "También podés cargarlo a mano (impuesto, base, alícuota o importe directo).",
        "Mirá el total: la <b>factura se cancela por el total</b>, del <b>banco sale sólo el neto</b> (total − retención).",
        "Confirmá el pago. La retención queda registrada como <b>practicada</b>, lista para depositar e informar.",
    ]))
    E.append(callout("Ejemplo: factura $1.000.000, retención $30.000 → transferís <b>$970.000</b>, el proveedor queda <b>saldado</b> "
                     "y queda una <b>obligación fiscal de $30.000</b> para depositar.", AMBER_BG, AMBER_BD, AMBER_TX))

    # ---- PARTE 3: Al cobrar (sufridas) ----
    E.append(Paragraph("PARTE 3 — Retención SUFRIDA (cuando te cobran / te retienen)", st_h2))
    E.append(bullets([
        "En el <b>cobro del cliente</b>, en <b>🧾 Retenciones sufridas</b>, agregá la retención que te hicieron (impuesto, régimen, importe, N° de certificado).",
        "La <b>factura queda saldada por el total</b> aunque al <b>banco entre sólo el neto</b>, y se registra el <b>crédito fiscal</b>.",
        "También podés cargarlas por separado: en <b>Retenciones</b>, con <b>🏦 Importar de ARCA (Excel)</b> (Mis Retenciones) o <b>+ Nueva retención</b>.",
    ]))

    # ---- PARTE 4: Liquidar + créditos ----
    E.append(Paragraph("PARTE 4 — Depositar al fisco y usar los créditos", st_h2))
    E.append(Paragraph("<b>Practicadas → depositar:</b>", st_intro))
    E.append(steps([
        "En <b>Retenciones</b> tocá <b>📥 A ingresar al fisco</b>: ves lo pendiente agrupado por impuesto y período.",
        "Tocá <b>Registrar pago</b>, elegí fecha y medio (banco o caja). Se <b>mueve la tesorería</b> y baja el pendiente "
        "(no se cuenta como gasto). Si te equivocaste, se puede <b>deshacer</b>.",
    ]))
    E.append(Paragraph("<b>Sufridas → crédito fiscal:</b>", st_intro))
    E.append(steps([
        "Tocá <b>🧾 Créditos fiscales</b>: ves cada retención sufrida con su <b>saldo pendiente</b> de computar.",
        "Con <b>Aplicar a DDJJ</b> imputás total o parcial contra un período. El sistema <b>no deja usar dos veces</b> el mismo saldo.",
    ]))

    # ---- PARTE 5: Certificados + presentación ----
    E.append(Paragraph("PARTE 5 — Certificados y presentación (ARCA / IIBB)", st_h2))
    E.append(bullets([
        "Cada retención tiene un <b>estado</b> de certificado: pendiente, emitido, verificado, informado, anulado (lo cambiás al editarla).",
        "Con <b>📄 Exportar SICORE/SIRE</b> (nacionales) o <b>SIRCAR</b> (IIBB) generás el archivo <b>por período</b>; "
        "con un tilde dejás las incluidas <b>marcadas como informadas</b>.",
        "Con <b>📊 Excel para el contador</b> bajás una planilla con <b>todas las retenciones y percepciones del período</b> "
        "(practicadas y sufridas) para cargar por lote o conciliar.",
    ]))
    E.append(callout("SIRE/SICORE/SIRCAR <b>no tienen conexión automática</b>: la presentación final se hace con <b>Clave Fiscal</b> "
                     "en ARCA / la provincia. Los .txt salen como <b>borrador</b>: validá el formato con tu contador la primera vez.",
                     INDIGO_BG, INDIGO_BD, INDIGO_TX))

    E.append(Paragraph("Preguntas frecuentes", st_h2))
    faqs = [
        ("¿Dónde está todo esto?", "En Tesorería → Retenciones. Las retenciones al pagar/cobrar se cargan dentro del mismo modal de pago o cobro."),
        ("¿La retención cambia el importe de la factura?", "No. La factura se cancela por su total; lo retenido no sale/entra del banco y se registra aparte."),
        ("¿Y las percepciones que vienen EN la factura de compra (combustibles, IIBB)?", "Esas se cargan en la factura, en la sección 'Otros impuestos y percepciones' (ver el instructivo de impuestos internos). Afectan el total a pagar."),
        ("Un proveedor tiene certificado de exclusión. ¿Qué hago?", "Cargalo en su ficha (impuesto, % y vigencia). Al retenerle, el sistema avisa y reduce o anula la retención automáticamente."),
        ("Me equivoqué en un depósito al fisco o en una aplicación de crédito.", "Los dos se pueden deshacer: el depósito desde 'Ver pagos ya hechos' y la aplicación desde el crédito."),
    ]
    for q,a in faqs:
        E.append(Paragraph(q, st_faq_q)); E.append(Paragraph(a, st_faq_a))

    doc.build(E)
    print("PDF generado:", OUT)

if __name__ == "__main__":
    build()
